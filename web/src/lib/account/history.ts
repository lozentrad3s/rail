/**
 * What this account has actually sent, read from the chain.
 *
 * The chain is the source of truth, not a cache on the device: the same passkey on a new phone must
 * show the same history, and a number on a dashboard that disagrees with the escrow is worse than
 * no number. So every figure here is summed from events `RailCore` emitted.
 *
 * `changeToSender` on `OrderSettled` is the money the auction gave back. The sender sets a ceiling,
 * providers undercut each other below it, and the difference returns (Rail invariant 5). It is the
 * only "reward" in Rail and it is not a reward at all, it is their own money that was never needed.
 */
import { parseAbi, type Address, type Hex } from "viem";

import { client, ESCROW } from "./chain";

/** The block the current escrow was deployed in. Nothing before it can concern this contract. */
const DEPLOYED_AT = BigInt(process.env.NEXT_PUBLIC_ESCROW_FROM_BLOCK || "64457000");

/** Public nodes cap a getLogs range, so a long history is fetched in pieces. */
const RANGE = 45_000n;

const events = parseAbi([
  "event OrderCreated(bytes32 indexed orderId, address indexed sender, bytes3 indexed currency, uint256 localAmount, uint256 maxAusd, uint256 fee, address attestor, bytes32 recipientCommitment, uint64 commitEnd, uint64 revealEnd)",
  "event OrderSettled(bytes32 indexed orderId, address indexed winner, uint256 paidToLp, uint256 changeToSender)",
  "event OrderRefunded(bytes32 indexed orderId, address indexed sender, uint256 escrow, uint256 slashed)",
]);

const [orderCreated, orderSettled, orderRefunded] = events;

export type TransferStatus = "running" | "delivered" | "returned";

export type Transfer = {
  orderId: Hex;
  /** Minor units of the local currency: kobo for naira. */
  localAmountMinor: bigint;
  currency: string;
  /** The ceiling the sender signed, plus the relayer's fee. */
  ceilingUnits: bigint;
  feeUnits: bigint;
  status: TransferStatus;
  /** What the winning provider was actually paid. Present once delivered. */
  paidUnits?: bigint;
  /** What came back because providers competed. Present once delivered. */
  returnedUnits?: bigint;
  block: bigint;
};

export type Totals = {
  delivered: number;
  running: number;
  /** Local currency actually delivered, in minor units. */
  deliveredLocalMinor: bigint;
  /** Dollars that left the account for good. */
  spentUnits: bigint;
  /** Dollars the auction handed back. The headline number. */
  returnedUnits: bigint;
};

/** `bytes3` of ASCII, so 0x4e474e reads NGN. */
function decodeCurrency(packed: Hex): string {
  let out = "";
  for (let i = 2; i < packed.length; i += 2) {
    const code = Number.parseInt(packed.slice(i, i + 2), 16);
    if (code > 0) out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Reads in windows, newest first, and stops early once it has enough.
 *
 * A dashboard that takes twenty seconds to appear is a dashboard nobody waits for, so this trades
 * completeness for arrival: `limit` transfers from the recent past beats every transfer eventually.
 */
export async function readHistory(
  address: Address,
  options: { limit?: number } = {},
): Promise<{ transfers: Transfer[]; totals: Totals; partial: boolean }> {
  const limit = options.limit ?? 25;
  const head = await client.getBlockNumber();

  const created: Transfer[] = [];
  let cursor = head;
  let partial = false;

  while (cursor > DEPLOYED_AT && created.length < limit) {
    const fromBlock = cursor - RANGE > DEPLOYED_AT ? cursor - RANGE : DEPLOYED_AT;

    let logs;
    try {
      logs = await client.getLogs({
        address: ESCROW,
        event: orderCreated,
        args: { sender: address },
        fromBlock,
        toBlock: cursor,
      });
    } catch {
      // A node that refuses a range is not a reason to show nothing: keep what was read and say so.
      partial = true;
      break;
    }

    for (const log of logs.reverse()) {
      const a = log.args;
      if (!a.orderId || a.localAmount === undefined) continue;
      created.push({
        orderId: a.orderId,
        localAmountMinor: a.localAmount,
        currency: a.currency ? decodeCurrency(a.currency) : "",
        ceilingUnits: a.maxAusd ?? 0n,
        feeUnits: a.fee ?? 0n,
        status: "running",
        block: log.blockNumber ?? 0n,
      });
    }

    if (fromBlock === DEPLOYED_AT) break;
    cursor = fromBlock - 1n;
  }

  const transfers = created.slice(0, limit);
  if (transfers.length === 0) {
    return { transfers, totals: emptyTotals(), partial };
  }

  // Outcomes are looked up by order id, so one window covering the oldest transfer is enough.
  const since = transfers.reduce((lowest, t) => (t.block < lowest ? t.block : lowest), head);
  const ids = new Set(transfers.map((t) => t.orderId.toLowerCase()));

  const [settled, refunded] = await Promise.all([
    client
      .getLogs({ address: ESCROW, event: orderSettled, fromBlock: since, toBlock: head })
      .catch(() => []),
    client
      .getLogs({ address: ESCROW, event: orderRefunded, args: { sender: address }, fromBlock: since, toBlock: head })
      .catch(() => []),
  ]);

  for (const log of settled) {
    const id = log.args.orderId?.toLowerCase();
    if (!id || !ids.has(id)) continue;
    const transfer = transfers.find((t) => t.orderId.toLowerCase() === id);
    if (!transfer) continue;
    transfer.status = "delivered";
    transfer.paidUnits = log.args.paidToLp ?? 0n;
    transfer.returnedUnits = log.args.changeToSender ?? 0n;
  }

  for (const log of refunded) {
    const id = log.args.orderId?.toLowerCase();
    if (!id) continue;
    const transfer = transfers.find((t) => t.orderId.toLowerCase() === id);
    // A refund returns the whole escrow, so nothing was spent and nothing was saved.
    if (transfer) transfer.status = "returned";
  }

  return { transfers, totals: totalsFor(transfers), partial };
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
    if (transfer.status === "running") {
      return { ...totals, running: totals.running + 1 };
    }
    // Returned in full: it neither cost nor saved anything.
    return totals;
  }, emptyTotals());
}
