/**
 * What this account has sent.
 *
 * Read one order at a time by id, not by scanning logs. The public Monad RPC caps `eth_getLogs` at
 * **100 blocks**, and this contract was deployed roughly 3.7 million blocks ago, so scanning for a
 * sender's history would need tens of thousands of requests and every one of them failed with 413
 * on the live site. A single `getOrder(orderId)` has no such limit.
 *
 * The cost is that history lives on the device that made it: the same passkey on a new phone shows
 * an empty list until it sends something. That is a real limitation and the honest fix is an
 * indexer, or a relayer endpoint that indexes by sender. Showing nothing was worse.
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

export type TransferStatus = "running" | "delivered" | "returned";

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
 * Called by `approveProposal` right after the relayer accepts it, because an order nobody wrote
 * down is an order this device can never show again.
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

export async function readHistory(
  address: Address,
  options: { limit?: number } = {},
): Promise<{ transfers: Transfer[]; totals: Totals; partial: boolean }> {
  const limit = options.limit ?? 25;
  const mine = readAll()
    .filter((o) => o.sender.toLowerCase() === address.toLowerCase())
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);

  if (mine.length === 0) return { transfers: [], totals: emptyTotals(), partial: false };

  const results = await Promise.all(
    mine.map(async (record) => {
      try {
        const order = await client.readContract({
          address: ESCROW,
          abi: coreAbi,
          functionName: "getOrder",
          args: [record.orderId],
        });

        const name = STATUS[order.status] ?? "None";
        // Refunded and Cancelled both return the escrow, so they read the same to a person.
        const status: TransferStatus =
          name === "Settled" ? "delivered" : name === "Refunded" || name === "Cancelled" ? "returned" : "running";

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

  const transfers = results.filter((t): t is Transfer => t !== undefined);
  return { transfers, totals: totalsFor(transfers), partial: transfers.length < mine.length };
}

const emptyTotals = (): Totals => ({
  delivered: 0,
  running: 0,
  deliveredLocalMinor: 0n,
  spentUnits: 0n,
  returnedUnits: 0n,
});

export function totalsFor(transfers: Transfer[]): Totals {
  return transfers.reduce<Totals>((totals, transfer) => {
    if (transfer.status === "delivered") {
      return {
        delivered: totals.delivered + 1,
        running: totals.running,
        deliveredLocalMinor: totals.deliveredLocalMinor + transfer.localAmountMinor,
        spentUnits: totals.spentUnits + (transfer.paidUnits ?? 0n) + transfer.feeUnits,
        returnedUnits: totals.returnedUnits + (transfer.returnedUnits ?? 0n),
      };
    }
    if (transfer.status === "running") return { ...totals, running: totals.running + 1 };
    return totals;
  }, emptyTotals());
}
