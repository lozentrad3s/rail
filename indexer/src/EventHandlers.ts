/**
 * Rail — event handlers.
 *
 * Everything here is derived from events the contracts emit. The indexer is a read model: if a
 * number cannot be reconstructed from the chain, it does not belong in here.
 */
import { indexer } from "envio";

const DAY = 86_400n;

/** `bytes3` currency code back to "NGN". */
function currencyCode(raw: string): string {
  const bytes = raw.replace(/^0x/, "").replace(/(00)+$/, "");
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
  return out;
}

function dayStart(timestamp: number | bigint): bigint {
  const ts = BigInt(timestamp);
  return ts - (ts % DAY);
}

function median(values: bigint[]): bigint | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2n;
}

type DayStat = {
  id: string;
  currency: string;
  dayStart: bigint;
  orders: number;
  settled: number;
  refunded: number;
  cancelled: number;
  localVolume: bigint;
  ausdVolume: bigint;
  senderSavings: bigint;
  medianSettlementBlocks: bigint | undefined;
  settlementBlockSamples: bigint[];
};

async function dayStatFor(
  context: { CurrencyDayStat: { getOrCreate: (e: DayStat) => Promise<DayStat> } },
  currency: string,
  timestamp: number | bigint,
): Promise<DayStat> {
  const start = dayStart(timestamp);
  return context.CurrencyDayStat.getOrCreate({
    id: `${currency}-${start}`,
    currency,
    dayStart: start,
    orders: 0,
    settled: 0,
    refunded: 0,
    cancelled: 0,
    localVolume: 0n,
    ausdVolume: 0n,
    senderSavings: 0n,
    medianSettlementBlocks: undefined,
    settlementBlockSamples: [],
  });
}

async function providerFor(context: any, address: string, block: bigint) {
  return context.LiquidityProvider.getOrCreate({
    id: address,
    staked: 0n,
    pendingUnstake: 0n,
    unlockAt: undefined,
    commits: 0,
    reveals: 0,
    wins: 0,
    settled: 0,
    defaults: 0,
    volumeSettled: 0n,
    slashedTotal: 0n,
    firstSeenBlock: block,
  });
}

/*//////////////////////////////////////////////////////////////
                              ORDERS
//////////////////////////////////////////////////////////////*/

indexer.onEvent({ contract: "RailCore", event: "OrderCreated" }, async ({ event, context }) => {
  const currency = currencyCode(event.params.currency);

  context.Order.set({
    id: event.params.orderId,
    sender: event.params.sender,
    currency,
    localAmount: event.params.localAmount,
    maxAusd: event.params.maxAusd,
    fee: event.params.fee,
    attestor: event.params.attestor,
    recipientCommitment: event.params.recipientCommitment,
    status: "Open",
    winner: undefined,
    winningBid: undefined,
    paidToLp: undefined,
    changeToSender: undefined,
    slashed: undefined,
    commitEnd: BigInt(event.params.commitEnd),
    revealEnd: BigInt(event.params.revealEnd),
    payoutDeadline: undefined,
    disputeEnd: undefined,
    resolutionEnd: undefined,
    createdBlock: BigInt(event.block.number),
    createdAt: BigInt(event.block.timestamp),
    awardedBlock: undefined,
    paidBlock: undefined,
    settledBlock: undefined,
    refundedBlock: undefined,
    settlementBlocks: undefined,
    bidCount: 0,
    revealCount: 0,
  });

  const stat = await dayStatFor(context, currency, event.block.timestamp);
  context.CurrencyDayStat.set({
    ...stat,
    orders: stat.orders + 1,
    localVolume: stat.localVolume + event.params.localAmount,
  });
});

indexer.onEvent({ contract: "RailCore", event: "BidCommitted" }, async ({ event, context }) => {
  const block = BigInt(event.block.number);
  const provider = await providerFor(context, event.params.lp, block);
  context.LiquidityProvider.set({ ...provider, commits: provider.commits + 1 });

  context.Bid.set({
    id: `${event.params.orderId}-${event.params.lp}`,
    order_id: event.params.orderId,
    lp_id: event.params.lp,
    commitment: event.params.commitment,
    committedBlock: block,
    amount: undefined,
    revealedBlock: undefined,
    leading: false,
    collateral: undefined,
    won: false,
  });

  const order = await context.Order.get(event.params.orderId);
  if (order) context.Order.set({ ...order, bidCount: order.bidCount + 1 });
});

indexer.onEvent({ contract: "RailCore", event: "BidRevealed" }, async ({ event, context }) => {
  const id = `${event.params.orderId}-${event.params.lp}`;
  const bid = await context.Bid.get(id);
  if (bid) {
    context.Bid.set({
      ...bid,
      amount: event.params.amount,
      revealedBlock: BigInt(event.block.number),
      leading: event.params.leading,
    });
  }

  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  context.LiquidityProvider.set({ ...provider, reveals: provider.reveals + 1 });

  const order = await context.Order.get(event.params.orderId);
  if (order) context.Order.set({ ...order, revealCount: order.revealCount + 1 });
});

indexer.onEvent({ contract: "RailCore", event: "CollateralLocked" }, async ({ event, context }) => {
  const bid = await context.Bid.get(`${event.params.orderId}-${event.params.lp}`);
  if (bid) context.Bid.set({ ...bid, collateral: event.params.amount });
});

indexer.onEvent({ contract: "RailCore", event: "OrderAwarded" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (order) {
    context.Order.set({
      ...order,
      status: "Awarded",
      winner: event.params.winner,
      winningBid: event.params.winningBid,
      payoutDeadline: BigInt(event.params.payoutDeadline),
      awardedBlock: BigInt(event.block.number),
    });
  }

  const bid = await context.Bid.get(`${event.params.orderId}-${event.params.winner}`);
  if (bid) context.Bid.set({ ...bid, won: true });

  const provider = await providerFor(context, event.params.winner, BigInt(event.block.number));
  context.LiquidityProvider.set({ ...provider, wins: provider.wins + 1 });
});

indexer.onEvent({ contract: "RailCore", event: "MarkedPaid" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (order) {
    context.Order.set({
      ...order,
      status: "Paid",
      disputeEnd: BigInt(event.params.disputeEnd),
      paidBlock: BigInt(event.block.number),
    });
  }
});

indexer.onEvent({ contract: "RailCore", event: "Disputed" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (order) {
    context.Order.set({
      ...order,
      status: "Disputed",
      resolutionEnd: BigInt(event.params.resolutionEnd),
    });
  }
});

indexer.onEvent({ contract: "RailCore", event: "OrderSettled" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (!order) return;

  const settledBlock = BigInt(event.block.number);
  const settlementBlocks = settledBlock - order.createdBlock;

  context.Order.set({
    ...order,
    status: "Settled",
    paidToLp: event.params.paidToLp,
    changeToSender: event.params.changeToSender,
    settledBlock,
    settlementBlocks,
  });

  const stat = await dayStatFor(context, order.currency, event.block.timestamp);
  const samples = [...stat.settlementBlockSamples, settlementBlocks];
  context.CurrencyDayStat.set({
    ...stat,
    settled: stat.settled + 1,
    ausdVolume: stat.ausdVolume + event.params.paidToLp,
    // What competition saved the sender against the price they were willing to pay.
    senderSavings: stat.senderSavings + event.params.changeToSender,
    settlementBlockSamples: samples,
    medianSettlementBlocks: median(samples),
  });
});

indexer.onEvent({ contract: "RailCore", event: "OrderRefunded" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (!order) return;

  context.Order.set({
    ...order,
    status: "Refunded",
    slashed: event.params.slashed,
    refundedBlock: BigInt(event.block.number),
  });

  const stat = await dayStatFor(context, order.currency, event.block.timestamp);
  context.CurrencyDayStat.set({ ...stat, refunded: stat.refunded + 1 });
});

indexer.onEvent({ contract: "RailCore", event: "OrderCancelled" }, async ({ event, context }) => {
  const order = await context.Order.get(event.params.orderId);
  if (!order) return;

  context.Order.set({ ...order, status: "Cancelled", refundedBlock: BigInt(event.block.number) });

  const stat = await dayStatFor(context, order.currency, event.block.timestamp);
  context.CurrencyDayStat.set({ ...stat, cancelled: stat.cancelled + 1 });
});

/*//////////////////////////////////////////////////////////////
                        DEFERRED PAYMENTS
//////////////////////////////////////////////////////////////*/

indexer.onEvent({ contract: "RailCore", event: "PaymentDeferred" }, async ({ event, context }) => {
  const existing = await context.DeferredPayment.getOrCreate({
    id: event.params.to,
    account: event.params.to,
    outstanding: 0n,
    totalDeferred: 0n,
    totalClaimed: 0n,
    lastBlock: BigInt(event.block.number),
  });

  context.DeferredPayment.set({
    ...existing,
    outstanding: existing.outstanding + event.params.amount,
    totalDeferred: existing.totalDeferred + event.params.amount,
    lastBlock: BigInt(event.block.number),
  });
});

indexer.onEvent({ contract: "RailCore", event: "Claimed" }, async ({ event, context }) => {
  const existing = await context.DeferredPayment.get(event.params.account);
  if (!existing) return;

  context.DeferredPayment.set({
    ...existing,
    outstanding: existing.outstanding - event.params.amount,
    totalClaimed: existing.totalClaimed + event.params.amount,
    lastBlock: BigInt(event.block.number),
  });
});

/*//////////////////////////////////////////////////////////////
                            PROVIDERS
//////////////////////////////////////////////////////////////*/

indexer.onEvent({ contract: "LPRegistry", event: "Staked" }, async ({ event, context }) => {
  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  // The event carries the running total, so this stays correct even if an event is replayed.
  context.LiquidityProvider.set({ ...provider, staked: event.params.staked });
});

indexer.onEvent({ contract: "LPRegistry", event: "UnstakeRequested" }, async ({ event, context }) => {
  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  context.LiquidityProvider.set({
    ...provider,
    staked: provider.staked - event.params.amount,
    pendingUnstake: provider.pendingUnstake + event.params.amount,
    unlockAt: BigInt(event.params.unlockAt),
  });
});

indexer.onEvent({ contract: "LPRegistry", event: "Withdrawn" }, async ({ event, context }) => {
  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  context.LiquidityProvider.set({
    ...provider,
    pendingUnstake: provider.pendingUnstake - event.params.amount,
    unlockAt: undefined,
  });
});

indexer.onEvent({ contract: "LPRegistry", event: "Settled" }, async ({ event, context }) => {
  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  context.LiquidityProvider.set({
    ...provider,
    settled: provider.settled + 1,
    volumeSettled: provider.volumeSettled + event.params.volume,
  });
});

indexer.onEvent({ contract: "LPRegistry", event: "Slashed" }, async ({ event, context }) => {
  const provider = await providerFor(context, event.params.lp, BigInt(event.block.number));
  context.LiquidityProvider.set({
    ...provider,
    defaults: provider.defaults + 1,
    slashedTotal: provider.slashedTotal + event.params.amount,
    staked: provider.staked - event.params.amount,
  });
});

/*//////////////////////////////////////////////////////////////
                           ATTESTATIONS
//////////////////////////////////////////////////////////////*/

indexer.onEvent({ contract: "SignedAttestor", event: "Attested" }, async ({ event, context }) => {
  context.Attestation.set({
    id: `${event.params.orderId}-${event.params.signer}`,
    order_id: event.params.orderId,
    signer: event.params.signer,
    layer: Number(event.params.layer),
    evidenceHash: event.params.evidenceHash,
    block: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  });
});
