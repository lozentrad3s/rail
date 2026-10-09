/**
 * What this account has sent.
 *
 * Read from the indexer first, by sender, so the same account shows the same history on every
 * device. It used to live only in the browser that made the transfer: a $76 order approved on a
 * phone from a Telegram link was "still running" on the phone and simply absent on the laptop, which
 * reads as money that vanished. The indexer is Envio, built only from `RailCore`'s events, so it is
 * a read model and never a second source of truth about money.
 *
 * The per-device list stays as the fallback, and covers the second or two before the indexer has
 * seen an order this device just submitted. Those are read one at a time by id, not by scanning
 * logs: the public Monad RPC caps `eth_getLogs` at 100 blocks, which made scanning hopeless.
 *
 * `maxAusd - winningBid` is the money the auction gave back (Rail invariant 5). It is the only
 * "reward" in Rail and it is not a reward at all: it is the sender's own money that was never
 * needed, because providers competed below the ceiling they set.
 */
import { parseAbi, type Address, type Hex } from "viem";

import { client, ESCROW } from "./chain";

const STORAGE_KEY = "rail.orders.v1";

/** Mirrors `Status` in contracts/src/interfaces/IRail.sol. */
const STATUS = ["None", "Open", "Awarded", "Paid", "Disputed", "Settled", "Refunded", "Cancelled"] as const;

const coreAbi = parseAbi([
  "struct Order { address sender; uint8 status; bytes3 currency; uint64 commitEnd; address winner; uint64 revealEnd; address attestor; uint64 payoutDeadline; uint128 maxAusd; uint128 winningBid; bytes32 recipientCommitment; uint256 localAmount; uint64 disputeEnd; uint64 resolutionEnd; }",
  "function getOrder(bytes32 orderId) view returns (Order)",
]);

/** The live Envio endpoint. On the development tier it changes per deployment, so set the env. */
export const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL || "https://indexer.dev.hyperindex.xyz/c7bc807/v1/graphql";

/**
 * `returning` is an order whose auction or payout window closed without a delivery. The escrow is
 * owed back and the relayer's sweeper refunds it within seconds, but until that lands it is neither
 * on its way nor returned — and calling it "on its way" is what made a stuck order look lost.
 */
export type TransferStatus = "running" | "returning" | "delivered" | "returned";

export type Transfer = {
  orderId: Hex;
  localAmountMinor: bigint;
  currency: string;
  ceilingUnits: bigint;
  feeUnits: bigint;
  status: TransferStatus;
  paidUnits?: bigint;
  /** What came back because providers competed. */
  returnedUnits?: bigint;
};

export type Totals = {
  delivered: number;
  running: number;
  returning: number;
  deliveredLocalMinor: bigint;
  spentUnits: bigint;
  returnedUnits: bigint;
};

type Remembered = { orderId: Hex; sender: Address; feeUnits: string; at: number };

function readAll(): Remembered[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Remembered[]) : [];
  } catch {
    return [];
  }
}

/**
 * Records an order the moment this device submits one.
 *
 * Called by `approveProposal` right after the relayer accepts it, so the order shows before the
 * indexer has caught up with it.
 */
export function rememberOrder(orderId: Hex, sender: Address, feeUnits: bigint): void {
  try {
    const kept = readAll().filter((o) => o.orderId.toLowerCase() !== orderId.toLowerCase());
    kept.push({ orderId, sender, feeUnits: feeUnits.toString(), at: Date.now() });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept.slice(-100)));
  } catch {
    // Storage can be refused. The transfer still happens; only this list loses it.
  }
}

function decodeCurrency(packed: Hex): string {
  let out = "";
  for (let i = 2; i < packed.length; i += 2) {
    const code = Number.parseInt(packed.slice(i, i + 2), 16);
    if (code > 0) out += String.fromCharCode(code);
  }
  return out;
}

type IndexedOrder = {
  id: Hex;
  status: string;
  currency: string;
  localAmount: string;
  maxAusd: string;
  fee: string;
  winner: string | null;
  winningBid: string | null;
  revealEnd: string;
  payoutDeadline: string | null;
};

/** Every order this sender has made, from the indexer. Throws when it cannot be reached. */
async function readIndexed(address: Address, limit: number): Promise<IndexedOrder[]> {
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // `_ilike`, because the indexer stores the checksummed form and a device may hold either.
      query: `query History($sender: String!, $limit: Int!) {
        Order(where: { sender: { _ilike: $sender } }, order_by: { createdAt: desc }, limit: $limit) {
          id status currency localAmount maxAusd fee winner winningBid revealEnd payoutDeadline
        }
      }`,
      variables: { sender: address, limit },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as { data?: { Order?: IndexedOrder[] } };
  if (!response.ok || !body.data?.Order) throw new Error("indexer unavailable");
  return body.data.Order;
}

/**
 * Whether a live order is past the point anybody can deliver it.
 *
 * Open past `revealEnd` with no winner is an auction nobody bid in; Awarded past `payoutDeadline` is
 * a provider who never paid. Either way `refund` is callable and the money is owed back.
 */
function closedWithoutDelivery(
  name: string,
  head: bigint,
  revealEnd: bigint,
  payoutDeadline: bigint,
  hasWinner: boolean,
): boolean {
  if (head === 0n) return false;
  if (name === "Open") return !hasWinner && head > revealEnd;
  if (name === "Awarded") return payoutDeadline > 0n && head > payoutDeadline;
  return false;
}

/** Refunded and Cancelled both return the escrow, so they read the same to a person. */
function statusOf(name: string, closed: boolean): TransferStatus | undefined {
  if (name === "Settled") return "delivered";
  if (name === "Refunded" || name === "Cancelled") return "returned";
  // Unknown to this escrow: an order from an older deployment, or one not mined yet.
  if (name === "None") return undefined;
  return closed ? "returning" : "running";
}

export async function readHistory(
  address: Address,
  options: { limit?: number } = {},
): Promise<{ transfers: Transfer[]; totals: Totals; partial: boolean }> {
  const limit = options.limit ?? 25;
  const mine = readAll()
    .filter((o) => o.sender.toLowerCase() === address.toLowerCase())
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  const [head, indexed] = await Promise.all([
    client.getBlockNumber().catch(() => 0n),
    readIndexed(address, limit).catch(() => undefined),
  ]);

  const fromIndexer: Transfer[] = [];
  for (const order of indexed ?? []) {
    const status = statusOf(
      order.status,
      closedWithoutDelivery(
        order.status,
        head,
        BigInt(order.revealEnd),
        BigInt(order.payoutDeadline ?? "0"),
        order.winner !== null,
      ),
    );
    if (!status) continue;

    const transfer: Transfer = {
      orderId: order.id,
      localAmountMinor: BigInt(order.localAmount),
      currency: order.currency,
      ceilingUnits: BigInt(order.maxAusd),
      feeUnits: BigInt(order.fee),
      status,
    };
    if (status === "delivered" && order.winningBid !== null) {
      transfer.paidUnits = BigInt(order.winningBid);
      transfer.returnedUnits = BigInt(order.maxAusd) - BigInt(order.winningBid);
    }
    fromIndexer.push(transfer);
  }

  // Anything this device submitted that the indexer has not seen yet, read from the chain by id.
  const known = new Set(fromIndexer.map((t) => t.orderId.toLowerCase()));
  const missing = mine.filter((record) => !known.has(record.orderId.toLowerCase()));

  const results = await Promise.all(
    missing.map(async (record) => {
      try {
        const order = await client.readContract({
          address: ESCROW,
          abi: coreAbi,
          functionName: "getOrder",
          args: [record.orderId],
        });

        const name = STATUS[order.status] ?? "None";
        const status = statusOf(
          name,
          closedWithoutDelivery(
            name,
            head,
            BigInt(order.revealEnd),
            BigInt(order.payoutDeadline),
            order.winner !== "0x0000000000000000000000000000000000000000",
          ),
        );
        if (!status) return undefined;

        const transfer: Transfer = {
          orderId: record.orderId,
          localAmountMinor: order.localAmount,
          currency: decodeCurrency(order.currency),
          ceilingUnits: BigInt(order.maxAusd),
          feeUnits: BigInt(record.feeUnits),
          status,
        };

        if (status === "delivered") {
          transfer.paidUnits = BigInt(order.winningBid);
          transfer.returnedUnits = BigInt(order.maxAusd) - BigInt(order.winningBid);
        }
        return transfer;
      } catch {
        return undefined;
      }
    }),
  );

  const fromDevice = results.filter((t): t is Transfer => t !== undefined);
  // What this device has just sent first, then the indexer's newest-first list.
  const transfers = [...fromDevice, ...fromIndexer].slice(0, limit);
  return {
    transfers,
    totals: totalsFor(transfers),
    // Only partial when the indexer was unreachable and the device list could not fill the gap.
    partial: indexed === undefined && fromDevice.length < mine.length,
  };
}

const emptyTotals = (): Totals => ({
  delivered: 0,
  running: 0,
  returning: 0,
  deliveredLocalMinor: 0n,
  spentUnits: 0n,
  returnedUnits: 0n,
});

export function totalsFor(transfers: Transfer[]): Totals {
  return transfers.reduce<Totals>((totals, transfer) => {
    if (transfer.status === "delivered") {
      return {
        ...totals,
        delivered: totals.delivered + 1,
        deliveredLocalMinor: totals.deliveredLocalMinor + transfer.localAmountMinor,
        spentUnits: totals.spentUnits + (transfer.paidUnits ?? 0n) + transfer.feeUnits,
        returnedUnits: totals.returnedUnits + (transfer.returnedUnits ?? 0n),
      };
    }
    if (transfer.status === "running") return { ...totals, running: totals.running + 1 };
    if (transfer.status === "returning") return { ...totals, returning: totals.returning + 1 };
    return totals;
  }, emptyTotals());
}
