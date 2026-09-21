/**
 * Pricing a transfer before anyone has bid on it.
 *
 * The quote is not a price — it is the *most* the sender agrees to pay. Providers then compete
 * below it, and whatever they do not take comes back to the sender (invariant 5). So the reserve
 * is set a little above the reference rate: too tight and nobody bids, too loose and the sender's
 * money sits in escrow longer than it needs to.
 */

/** Local currencies are quoted in minor units (kobo, pesewa): 100 make one unit. */
const MINOR_PER_UNIT = 100n;
/** AUSD has 6 decimals. */
const AUSD_DECIMALS = 1_000_000n;
const BPS = 10_000n;

export type Quote = {
  currency: string;
  localAmount: bigint;
  /** What the transfer is worth at the reference rate. */
  indicativeAusd: bigint;
  /** The reserve price the sender signs. */
  maxAusd: bigint;
  fee: bigint;
  /** Local-currency units per dollar. */
  rate: bigint;
  expiresAt: number;
};

export type QuoteInput = {
  currency: string;
  localAmountMinor: bigint;
  rate: bigint;
  reserveBufferBps: bigint;
  feeAusd: bigint;
  ttlSeconds: number;
  now?: number;
};

export function priceTransfer(input: QuoteInput): Quote {
  const { currency, localAmountMinor, rate, reserveBufferBps, feeAusd, ttlSeconds } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);

  // Integer maths throughout, rounding up, so the sender is never quoted less than the transfer is
  // worth and a provider is never asked to deliver at a loss because of truncation.
  const indicativeAusd = ceilDiv(localAmountMinor * AUSD_DECIMALS, MINOR_PER_UNIT * rate);
  const maxAusd = ceilDiv(indicativeAusd * (BPS + reserveBufferBps), BPS);

  return {
    currency,
    localAmount: localAmountMinor,
    indicativeAusd,
    maxAusd,
    fee: feeAusd,
    rate,
    expiresAt: now + ttlSeconds,
  };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
