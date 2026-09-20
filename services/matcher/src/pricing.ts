/**
 * What a provider is willing to charge for delivering local currency.
 *
 * The interface exists so a real provider can plug in their treasury desk's live rate, or an API
 * like AZA's, without touching the auction logic.
 */

export class PriceError extends Error {
  readonly currency: string;

  constructor(currency: string) {
    super(`no price for ${currency}`);
    this.name = "PriceError";
    this.currency = currency;
  }
}

export interface PriceSource {
  /** AUSD base units this provider wants in exchange for delivering `localAmountMinor`. */
  price(currency: string, localAmountMinor: bigint): bigint;
}

/** Local currencies are quoted in minor units (kobo, pesewa): 100 of them make one unit. */
const MINOR_PER_UNIT = 100n;
/** AUSD has 6 decimals. */
const AUSD_DECIMALS = 1_000_000n;
const BPS = 10_000n;

/** A fixed rate plus a margin. What most providers start with. */
export class StaticRate implements PriceSource {
  readonly #rate: bigint;
  readonly #spreadBps: bigint;
  readonly #currencies: string[];

  constructor(rate: bigint, spreadBps: bigint, currencies: string[]) {
    this.#rate = rate;
    this.#spreadBps = spreadBps;
    this.#currencies = currencies;
  }

  price(currency: string, localAmountMinor: bigint): bigint {
    if (!this.#currencies.includes(currency)) throw new PriceError(currency);

    // dollars = local / rate, then add the margin — all in integers, so two providers running the
    // same numbers agree exactly rather than drifting by a float.
    const numerator = localAmountMinor * AUSD_DECIMALS * (BPS + this.#spreadBps);
    const denominator = MINOR_PER_UNIT * this.#rate * BPS;

    // Round up: a provider must never bid below its own price because of truncation.
    return (numerator + denominator - 1n) / denominator;
  }
}
