/**
 * Rail matcher — the reference liquidity provider bot.
 *
 * It watches for orders, prices them, bids in the sealed auction, and when it wins, pays the
 * recipient and says so on-chain. Run two of these with different spreads and the cheaper one
 * wins, which is the whole argument for the protocol.
 *
 * It holds one key, which can stake collateral and bid. It never holds a sender's money.
 */
import { createPublicClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { Bidder, type OrderCreated } from "./auction.ts";
import { loadConfig } from "./config.ts";
import { StaticRate } from "./pricing.ts";
import { lpRegistryAbi, railCoreAbi } from "./rail.ts";
import { Store } from "./store.ts";

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

  const bidder = new Bidder({
    publicClient,
    walletClient,
    account: account.address,
    config,
    prices: new StaticRate(config.rate, config.spreadBps, config.currencies),
    store: new Store(config.stateDir),
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

  let fromBlock = await publicClient.getBlockNumber();
  log("watching", { fromBlock, pollMs: config.pollIntervalMs });

  let stopping = false;
  process.on("SIGINT", () => {
    log("stopping");
    stopping = true;
  });

  while (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));

    let latest: bigint;
    try {
      latest = await publicClient.getBlockNumber();
    } catch (error) {
      log("chain-head-unreadable", { error: String(error).slice(0, 120) });
      continue;
    }
    if (latest < fromBlock) continue;

    let logs;
    try {
      logs = await publicClient.getLogs({ address: config.railCore, fromBlock, toBlock: latest });
    } catch (error) {
      log("logs-unreadable", { error: String(error).slice(0, 120) });
      continue;
    }
    fromBlock = latest + 1n;

    const created = parseEventLogs({ abi: railCoreAbi, eventName: "OrderCreated", logs });

    for (const entry of created) {
      const event: OrderCreated = {
        orderId: entry.args.orderId,
        currency: entry.args.currency,
        localAmount: entry.args.localAmount,
        maxAusd: entry.args.maxAusd,
        attestor: entry.args.attestor,
        commitEnd: BigInt(entry.args.commitEnd),
        revealEnd: BigInt(entry.args.revealEnd),
      };

      // Deliberately not awaited: the commit window is about a second and a half, so a slow
      // auction must never hold up the next one.
      void bidder
        .handleOrder(event)
        .then((outcome) => log(`outcome:${outcome.kind}`, { order: event.orderId, ...outcome }))
        .catch((error) => log("bid-failed", { order: event.orderId, error: String(error).slice(0, 200) }));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
