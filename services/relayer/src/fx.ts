/**
 * What a dollar is worth today.
 *
 * This used to be a constant, and the constant went stale. On 2 Oct 2026 it still read 1,534 NGN
 * per dollar while the market was at 1,328, which meant the relayer quoted a ceiling of $33.25 for
 * a transfer that costs $37.65 to deliver. No provider can fill that, so every order would have sat
 * through its auction unbid and refunded. A stale rate is not a cosmetic bug, it is an outage.
 *
 * So the rate is fetched, cached briefly, and the constant survives only as the answer to "the feed
 * is down", where being approximately right beats refusing to quote.
 */
import { RelayerError } from "./errors.ts";

/** Rates move on a scale of minutes at most; quoting is on a request path. */
const CACHE_MS = 5 * 60 * 1000;

/** Beyond this the feed is wrong, not the market. Refuse rather than quote nonsense. */
const SANITY = { min: 1n, max: 1_000_000n };

export type FxSource = {
  url: string;
  /** Used when the feed cannot be reached. Dated, because a fallback that looks live is a trap. */
  fallback: bigint;
  fetchImpl?: typeof fetch;
};

export type Rate = {
  /** Local-currency minor-unit-free rate: whole local units per dollar. */
  rate: bigint;
  /** Where it came from, so a quote can be explained after the fact. */
  source: "live" | "fallback";
  asOf: number;
};

type Cached = { rate: bigint; at: number };
const cache = new Map<string, Cached>();

/** Exported for tests, and for an operator who needs a quote to re-read the feed now. */
export function clearRateCache(): void {
  cache.clear();
}

function parseRate(body: unknown, currency: string): bigint | undefined {
  const rates = (body as { rates?: Record<string, unknown> })?.rates;
  const raw = rates?.[currency];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;

  // Rounded to a whole local unit: a sub-naira fraction is below the precision anyone transacts in,
  // and keeping it would imply accuracy the feed does not have.
  const rounded = BigInt(Math.round(raw));
  if (rounded < SANITY.min || rounded > SANITY.max) return undefined;
  return rounded;
}

/**
 * The rate to quote with.
 *
 * Never throws for a feed problem. A sender waiting on a quote is better served by a slightly stale
 * number they can still decline than by an error, and the reserve buffer above the indicative price
 * exists precisely to absorb this kind of drift.
 */
export async function currentRate(source: FxSource, currency: string): Promise<Rate> {
  const key = currency.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { rate: hit.rate, source: "live", asOf: hit.at };
  }

  const doFetch = source.fetchImpl ?? fetch;
  try {
    const response = await doFetch(source.url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`status ${response.status}`);

    const rate = parseRate(await response.json(), key);
    if (rate === undefined) throw new Error(`no usable ${key} rate`);

    cache.set(key, { rate, at: Date.now() });
    return { rate, source: "live", asOf: Date.now() };
  } catch {
    // Deliberately quiet: this is an expected condition on a request path, not an incident.
    return { rate: source.fallback, source: "fallback", asOf: 0 };
  }
}

/** Used at startup so a misconfigured fallback fails loudly rather than at the first quote. */
export function assertSaneFallback(fallback: bigint): void {
  if (fallback < SANITY.min || fallback > SANITY.max) {
    throw new RelayerError("INTERNAL", "FALLBACK_RATE is outside any plausible range");
  }
}
