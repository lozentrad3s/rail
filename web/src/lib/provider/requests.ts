/**
 * Live transfer requests, and the bid state a provider must not lose.
 *
 * The salt is the dangerous part. A sealed bid is `keccak256(orderId, lp, amount, salt)`, and the
 * reveal has to present the same salt. Lose it between commit and reveal and the bid can never be
 * revealed: the provider's collateral stays locked until the auction closes and they have simply
 * burned the opportunity. So it is written to storage the instant it is generated, before the
 * transaction is sent, and only cleared once the reveal is mined.
 */
import { encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";

import { auction } from "@/lib/site";
import { INDEXER_URL } from "@/lib/account/history";

import { client, ESCROW } from "./chain";

const STORAGE_KEY = "rail.provider.bids.v1";

const orderCreated = parseAbi([
  "event OrderCreated(bytes32 indexed orderId, address indexed sender, bytes3 indexed currency, uint256 localAmount, uint256 maxAusd, uint256 fee, address attestor, bytes32 recipientCommitment, uint64 commitEnd, uint64 revealEnd)",
])[0];

const orderAwarded = parseAbi([
  "event OrderAwarded(bytes32 indexed orderId, address indexed winner, uint256 winningBid, uint64 payoutDeadline)",
])[0];

export type Phase = "commit" | "reveal" | "closed";

export type Request = {
  orderId: Hex;
  currency: string;
  /** Minor units of the local currency: kobo for naira. */
  localAmountMinor: bigint;
  /** The most the sender will pay. A bid above this is refused. */
  ceilingUnits: bigint;
  commitEnd: bigint;
  revealEnd: bigint;
  phase: Phase;
  /** Blocks left in the current phase. Zero means the phase is over. */
  blocksLeft: bigint;
};

function decodeCurrency(packed: Hex): string {
  let out = "";
  for (let i = 2; i < packed.length; i += 2) {
    const code = Number.parseInt(packed.slice(i, i + 2), 16);
    if (code > 0) out += String.fromCharCode(code);
  }
  return out;
}

/** The chain's own view of a request, from its events. */
type RawRequest = {
  orderId: Hex;
  currency: string;
  localAmountMinor: bigint;
  ceilingUnits: bigint;
  commitEnd: bigint;
  revealEnd: bigint;
};

function withPhase(raw: RawRequest, head: bigint): Request | undefined {
  if (head > raw.revealEnd) return undefined;
  const phase: Phase = head <= raw.commitEnd ? "commit" : "reveal";
  const until = phase === "commit" ? raw.commitEnd : raw.revealEnd;
  return { ...raw, phase, blocksLeft: until > head ? until - head : 0n };
}

/**
 * From the indexer: every order still Open whose reveal window has not passed, in one query.
 *
 * Throws when the indexer cannot be reached, so the caller falls back to the chain.
 */
async function fromIndexer(head: bigint): Promise<RawRequest[]> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query Open($head: numeric!) {
        Order(where: { status: { _eq: "Open" }, revealEnd: { _gt: $head } }, limit: 50) {
          id currency localAmount maxAusd commitEnd revealEnd
        }
      }`,
      variables: { head: head.toString() },
    }),
    signal: AbortSignal.timeout(6_000),
  });
  const body = (await response.json()) as {
    data?: { Order?: { id: Hex; currency: string; localAmount: string; maxAusd: string; commitEnd: string; revealEnd: string }[] };
  };
  if (!response.ok || !body.data?.Order) throw new Error("indexer unavailable");
  return body.data.Order.map((order) => ({
    orderId: order.id,
    currency: order.currency,
    localAmountMinor: BigInt(order.localAmount),
    ceilingUnits: BigInt(order.maxAusd),
    commitEnd: BigInt(order.commitEnd),
    revealEnd: BigInt(order.revealEnd),
  }));
}

/** The public RPC refuses an `eth_getLogs` range wider than 100 blocks. */
const LOG_PAGE = 99n;

/**
 * From the chain, when the indexer is down: every page of logs across the whole span a request can
 * still be biddable in. One 100-block look was the bug — with 150-block windows it showed a request
 * for barely half of its bidding time and never during its reveal, where the Reveal button lives.
 */
async function fromChain(head: bigint): Promise<RawRequest[]> {
  const span = BigInt(auction.commitBlocks + auction.revealBlocks) + 10n;
  const from = head > span ? head - span : 0n;
  const pages: [bigint, bigint][] = [];
  for (let start = from; start <= head; start += LOG_PAGE + 1n) {
    pages.push([start, start + LOG_PAGE > head ? head : start + LOG_PAGE]);
  }

  const [created, awarded] = await Promise.all([
    Promise.all(pages.map(([fromBlock, toBlock]) => client.getLogs({ address: ESCROW, event: orderCreated, fromBlock, toBlock }))),
    Promise.all(
      pages.map(([fromBlock, toBlock]) =>
        client.getLogs({ address: ESCROW, event: orderAwarded, fromBlock, toBlock }).catch(() => []),
      ),
    ),
  ]);
  const closed = new Set(awarded.flat().map((log) => log.args.orderId?.toLowerCase()));

  const raw: RawRequest[] = [];
  for (const log of created.flat()) {
    const a = log.args;
    if (!a.orderId || a.commitEnd === undefined || a.revealEnd === undefined) continue;
    if (closed.has(a.orderId.toLowerCase())) continue;
    raw.push({
      orderId: a.orderId,
      currency: a.currency ? decodeCurrency(a.currency) : "",
      localAmountMinor: a.localAmount ?? 0n,
      ceilingUnits: a.maxAusd ?? 0n,
      commitEnd: BigInt(a.commitEnd),
      revealEnd: BigInt(a.revealEnd),
    });
  }
  return raw;
}

/** Only orders still biddable or revealable, newest first. */
export async function readOpenRequests(): Promise<Request[]> {
  const head = await client.getBlockNumber();
  const raw = await fromIndexer(head).catch(() => fromChain(head));
  return raw
    .map((request) => withPhase(request, head))
    .filter((request): request is Request => request !== undefined)
    .sort((a, b) => Number(b.commitEnd - a.commitEnd));
}

export type StoredBid = {
  orderId: Hex;
  lp: Address;
  /** Decimal string: a bigint does not survive JSON. */
  amount: string;
  salt: Hex;
  committedAt: number;
  revealed: boolean;
};

function readAll(): StoredBid[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredBid[]) : [];
  } catch {
    // A provider with blocked storage must not be able to commit at all, which the caller checks.
    return [];
  }
}

function writeAll(bids: StoredBid[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bids));
    return true;
  } catch {
    return false;
  }
}

/** True when a salt can actually be kept. Committing without this is committing to lose. */
export function canRememberBids(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const bidFor = (orderId: Hex, lp: Address): StoredBid | undefined =>
  readAll().find(
    (bid) => bid.orderId.toLowerCase() === orderId.toLowerCase() && bid.lp.toLowerCase() === lp.toLowerCase(),
  );

export const pendingReveals = (lp: Address): StoredBid[] =>
  readAll().filter((bid) => !bid.revealed && bid.lp.toLowerCase() === lp.toLowerCase());

/** The sealed commitment, matching `keccak256(abi.encode(orderId, lp, amount, salt))` on chain. */
export function commitmentFor(orderId: Hex, lp: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, address, uint256, bytes32"), [
      orderId,
      lp,
      amount,
      salt,
    ]),
  );
}

export function randomSalt(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

/**
 * Records a bid before it is sent.
 *
 * Returns false when storage refuses, and the caller must not send the transaction: a committed bid
 * whose salt was never stored is collateral locked for nothing.
 */
export function rememberBid(bid: Omit<StoredBid, "committedAt" | "revealed">): boolean {
  const bids = readAll().filter(
    (existing) =>
      !(
        existing.orderId.toLowerCase() === bid.orderId.toLowerCase() &&
        existing.lp.toLowerCase() === bid.lp.toLowerCase()
      ),
  );
  bids.push({ ...bid, committedAt: Date.now(), revealed: false });
  return writeAll(bids.slice(-200));
}

export function markRevealed(orderId: Hex, lp: Address): void {
  const bids = readAll().map((bid) =>
    bid.orderId.toLowerCase() === orderId.toLowerCase() && bid.lp.toLowerCase() === lp.toLowerCase()
      ? { ...bid, revealed: true }
      : bid,
  );
  writeAll(bids);
}

/*//////////////////////////////////////////////////////////////
                              WINS
//////////////////////////////////////////////////////////////*/

const getOrderAbi = parseAbi([
  "struct Order { address sender; uint8 status; bytes3 currency; uint64 commitEnd; address winner; uint64 revealEnd; address attestor; uint64 payoutDeadline; uint128 maxAusd; uint128 winningBid; bytes32 recipientCommitment; uint256 localAmount; uint64 disputeEnd; uint64 resolutionEnd; }",
  "function getOrder(bytes32 orderId) view returns (Order)",
]);

/**
 * `pay`: won, the bank transfer is owed. `paid`: marked paid, waiting to settle. `settled`: done.
 *
 * An order a provider won is no longer Open, so it left the request list — and with it the only
 * button that showed the account to pay. A human winner lost the screen they needed at the exact
 * moment they needed it. Wins are their own list now.
 */
export type WinStage = "pay" | "paid" | "settled";

export type Win = {
  orderId: Hex;
  currency: string;
  localAmountMinor: bigint;
  bidUnits: bigint;
  stage: WinStage;
  /** Blocks left to pay before the order can be refunded and the collateral slashed. */
  blocksToPay: bigint;
};

/** Order ids this provider won, from the indexer. Empty when it cannot be reached. */
async function wonFromIndexer(lp: Address): Promise<Hex[]> {
  try {
    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query Won($lp: String!) {
          Order(where: { winner: { _ilike: $lp } }, order_by: { createdAt: desc }, limit: 10) { id }
        }`,
        variables: { lp },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    const body = (await response.json()) as { data?: { Order?: { id: Hex }[] } };
    return body.data?.Order?.map((order) => order.id) ?? [];
  } catch {
    return [];
  }
}

/**
 * Everything this provider has won and not long since finished, read from the chain for truth.
 *
 * Candidates come from two places — bids this device sealed, and the indexer's list of orders this
 * address won — so a win shows even on a device that did not bid, and even with the indexer down.
 */
export async function readWins(lp: Address): Promise<Win[]> {
  const mine = readAll()
    .filter((bid) => bid.lp.toLowerCase() === lp.toLowerCase())
    .sort((a, b) => b.committedAt - a.committedAt)
    .slice(0, 15)
    .map((bid) => bid.orderId);
  const ids = [...new Set([...mine, ...(await wonFromIndexer(lp))].map((id) => id.toLowerCase() as Hex))];
  if (ids.length === 0) return [];

  const head = await client.getBlockNumber();
  const orders = await Promise.all(
    ids.map((orderId) =>
      client
        .readContract({ address: ESCROW, abi: getOrderAbi, functionName: "getOrder", args: [orderId] })
        .then((order) => ({ orderId, order }))
        .catch(() => undefined),
    ),
  );

  const wins: Win[] = [];
  for (const entry of orders) {
    if (!entry || entry.order.winner.toLowerCase() !== lp.toLowerCase()) continue;
    const { order, orderId } = entry;
    // Open with a winner and past reveal is Awarded in everything but name (`_effectiveStatus`).
    const awarded = order.status === 2 || (order.status === 1 && head > BigInt(order.revealEnd));
    const stage: WinStage | undefined = awarded
      ? "pay"
      : order.status === 3 || order.status === 4
        ? "paid"
        : order.status === 5
          ? "settled"
          : undefined;
    if (!stage) continue;
    const deadline = BigInt(order.payoutDeadline);
    wins.push({
      orderId,
      currency: decodeCurrency(order.currency),
      localAmountMinor: order.localAmount,
      bidUnits: BigInt(order.winningBid),
      stage,
      blocksToPay: deadline > head ? deadline - head : 0n,
    });
  }
  const order: Record<WinStage, number> = { pay: 0, paid: 1, settled: 2 };
  return wins.sort((a, b) => order[a.stage] - order[b.stage]).slice(0, 8);
}
