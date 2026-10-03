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

/** Only orders still biddable. An order whose reveal window has closed is somebody else's problem. */
export async function readOpenRequests(lookback = 2_000n): Promise<Request[]> {
  const head = await client.getBlockNumber();
  const fromBlock = head > lookback ? head - lookback : 0n;

  const [created, awarded] = await Promise.all([
    client.getLogs({ address: ESCROW, event: orderCreated, fromBlock, toBlock: head }),
    client.getLogs({ address: ESCROW, event: orderAwarded, fromBlock, toBlock: head }).catch(() => []),
  ]);

  const settled = new Set(awarded.map((log) => log.args.orderId?.toLowerCase()));

  const open: Request[] = [];
  for (const log of created) {
    const a = log.args;
    if (!a.orderId || a.commitEnd === undefined || a.revealEnd === undefined) continue;
    if (settled.has(a.orderId.toLowerCase())) continue;

    const commitEnd = BigInt(a.commitEnd);
    const revealEnd = BigInt(a.revealEnd);
    if (head > revealEnd) continue;

    const phase: Phase = head <= commitEnd ? "commit" : "reveal";
    const until = phase === "commit" ? commitEnd : revealEnd;

    open.push({
      orderId: a.orderId,
      currency: a.currency ? decodeCurrency(a.currency) : "",
      localAmountMinor: a.localAmount ?? 0n,
      ceilingUnits: a.maxAusd ?? 0n,
      commitEnd,
      revealEnd,
      phase,
      blocksLeft: until > head ? until - head : 0n,
    });
  }

  return open.sort((a, b) => Number(b.commitEnd - a.commitEnd));
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
