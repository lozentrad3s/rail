/**
 * Rail matcher — the reference liquidity provider bot.
 *
 * It watches for orders, prices them, bids in the sealed auction, and when it wins, pays the
 * recipient and says so on-chain. Run two of these with different spreads and the cheaper one
 * wins, which is the whole argument for the protocol.
 *
 * It holds one key, which can stake collateral and bid. It never holds a sender's money.
 *
 * Orders arrive over a WebSocket subscription. Polling was measured at ~550ms per `eth_getLogs`
 * against the public RPC, which is most of a five-block commit window spent waiting — the first
 * live run lost both bids exactly that way. Polling stays as a fallback for when the socket will
 * not open.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  webSocket,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { Bidder, type OrderCreated } from "./auction.ts";
import { loadConfig } from "./config.ts";
import { StaticRate } from "./pricing.ts";
import { lpRegistryAbi, railCoreAbi } from "./rail.ts";
import { Store } from "./store.ts";
import { Sender } from "./tx.ts";

/** The public RPC rejects wider ranges than this. */
const MAX_LOG_RANGE = 99n;

/** Unwraps the chain of causes, so a revert reason reaches the log rather than "commitBid failed". */
function describe(error: unknown, depth = 3): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let i = 0; current && i < depth; i++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" <- ").replace(/[\r\n]+/g, " ").slice(0, 400);
}

function log(event: string, detail: Record<string, unknown> = {}): void {
  const body = Object.entries(detail)
    .map(([key, value]) => `${key}=${typeof value === "bigint" ? value.toString() : String(value)}`)
    .join(" ");
  console.log(`${new Date().toISOString()} ${event}${body ? ` ${body}` : ""}`);
}

async function main(): Promise<void> {
  const config = loadConfig();

  // The key stays in the environment and is never logged, only used to sign.
  const rawKey = process.env.LP_PRIVATE_KEY?.trim();
  if (!rawKey) throw new Error("LP_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(rawKey as Hex);

  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(config.rpcUrl) });

  const sender = new Sender({
    publicClient,
    walletClient,
    account,
    address: account.address,
    abi: railCoreAbi,
    contract: config.railCore,
  });

  // The head is pushed, not polled: asking the RPC costs ~250ms, which is most of a Monad block,
  // and the first live runs missed the commit window by exactly one block because of it.
  let head = 0n;

  const bidder = new Bidder({
    publicClient,
    walletClient,
    account: account.address,
    config,
    prices: new StaticRate(config.rate, config.spreadBps, config.currencies),
    store: new Store(config.stateDir),
    sender,
    head: () => head,
    log,
  });

  log("starting", { lp: account.address, label: config.label, core: config.railCore });

  // Two checks before risking a provider's collateral.
  await bidder.verifyCommitmentScheme();
  const eligible = await publicClient.readContract({
    address: config.lpRegistry,
    abi: lpRegistryAbi,
    functionName: "isEligible",
    args: [account.address],
  });
  if (!eligible) {
    throw new Error(
      `this account cannot bid yet: stake at least the minimum in LPRegistry at ${config.lpRegistry}`,
    );
  }
  const freeStake = await publicClient.readContract({
    address: config.lpRegistry,
    abi: lpRegistryAbi,
    functionName: "freeStake",
    args: [account.address],
  });
  log("eligible", { freeStake });

  // Nonce and fees are fetched now, so a live bid costs one round trip instead of four.
  await sender.prime();

  const seen = new Set<string>();

  const bidOn = (logs: Log[]): void => {
    for (const entry of parseEventLogs({ abi: railCoreAbi, eventName: "OrderCreated", logs })) {
      // The socket and the fallback poller can both deliver the same order.
      if (seen.has(entry.args.orderId)) continue;
      seen.add(entry.args.orderId);

      const event: OrderCreated = {
        orderId: entry.args.orderId,
        currency: entry.args.currency,
        localAmount: entry.args.localAmount,
        maxAusd: entry.args.maxAusd,
        attestor: entry.args.attestor,
        commitEnd: BigInt(entry.args.commitEnd),
        revealEnd: BigInt(entry.args.revealEnd),
      };

      // Deliberately not awaited: an auction in progress must never delay the next one.
      void bidder
        .handleOrder(event)
        .then((outcome) => log(`outcome:${outcome.kind}`, { order: event.orderId, ...outcome }))
        .catch((error) => log("bid-failed", { order: event.orderId, error: describe(error) }));
    }
  };

  let stopping = false;
  const stop = (): void => {
    log("stopping");
    stopping = true;
    sender.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (await subscribe(config.wsUrl, config.railCore, bidOn, (block) => (head = block))) {
    log("watching", { via: "websocket", url: config.wsUrl });
    while (!stopping) await new Promise((resolve) => setTimeout(resolve, 500));
    return;
  }

  // Polling fallback: the head has to come from somewhere, so it comes from the loop below.
  head = await publicClient.getBlockNumber();

  log("watching", { via: "polling", pollMs: config.pollIntervalMs, why: "socket would not open" });
  let fromBlock = await publicClient.getBlockNumber();

  while (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));

    try {
      head = await publicClient.getBlockNumber();
      if (head < fromBlock) continue;

      // The public RPC limits the range, and falling behind it must not wedge the bot.
      const toBlock = head - fromBlock > MAX_LOG_RANGE ? fromBlock + MAX_LOG_RANGE : head;
      const logs = await publicClient.getLogs({ address: config.railCore, fromBlock, toBlock });
      fromBlock = toBlock + 1n;
      bidOn(logs);
    } catch (error) {
      log("poll-failed", { error: describe(error) });
      // Re-anchor on the head rather than retrying a range that may itself be the problem.
      try {
        fromBlock = await publicClient.getBlockNumber();
      } catch {
        // Try again on the next tick.
      }
    }
  }
}

/**
 * Subscribes to new orders and to the chain head. Returns false when the socket cannot be used.
 *
 * Both subscriptions matter: one says an auction has started, the other says what time it is — and
 * knowing the time without asking is what makes a five-block window reachable.
 */
async function subscribe(
  url: string,
  address: Hex,
  onLogs: (logs: Log[]) => void,
  onHead: (block: bigint) => void,
): Promise<boolean> {
  try {
    const socket = createPublicClient({
      chain: monadTestnet,
      transport: webSocket(url, { retryCount: 3, timeout: 10_000 }),
    });
    onHead(await socket.getBlockNumber());

    socket.watchBlockNumber({
      onBlockNumber: onHead,
      onError: (error) => log("head-error", { error: describe(error) }),
    });

    socket.watchContractEvent({
      address,
      abi: railCoreAbi,
      eventName: "OrderCreated",
      onLogs: (logs) => onLogs(logs as Log[]),
      onError: (error) => log("watch-error", { error: describe(error) }),
    });
    return true;
  } catch (error) {
    log("websocket-unavailable", { error: describe(error) });
    return false;
  }
}

main().catch((error) => {
  console.error(describe(error));
  process.exitCode = 1;
});
