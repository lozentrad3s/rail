/**
 * The rate a quote is priced at.
 *
 * This file exists because a constant went stale and broke the product silently. At 1,534 NGN per
 * dollar the relayer quoted a $33.25 ceiling for a transfer costing $37.65 to deliver: no provider
 * could fill it, so every auction closed unbid and every order refunded. Nothing errored. The
 * cases below are the ways that can happen again.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { clearRateCache, currentRate } from "../src/fx.ts";

const FALLBACK = 1_328n;

const feed = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as
    unknown as typeof fetch;

const source = (fetchImpl: typeof fetch) => ({
  url: "https://fx.example/latest",
  fallback: FALLBACK,
  fetchImpl,
});

beforeEach(() => clearRateCache());

describe("a working feed", () => {
  it("uses the live rate", async () => {
    const rate = await currentRate(source(feed({ rates: { NGN: 1327.682521 } })), "NGN");
    assert.equal(rate.source, "live");
    // Rounded to a whole naira: a fraction of one is below anything anybody transacts in.
    assert.equal(rate.rate, 1_328n);
  });

  it("is case-insensitive about the currency", async () => {
    const rate = await currentRate(source(feed({ rates: { NGN: 1300 } })), "ngn");
    assert.equal(rate.rate, 1_300n);
  });

  it("caches, so quoting does not hammer the feed", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ rates: { NGN: 1300 } }), { status: 200 });
    }) as unknown as typeof fetch;

    await currentRate(source(counting), "NGN");
    await currentRate(source(counting), "NGN");
    assert.equal(calls, 1);
  });
});

describe("a feed that cannot be trusted", () => {
  // Falling back is correct. Throwing would mean a sender cannot get a quote at all, and the
  // reserve buffer above the indicative price exists to absorb exactly this drift.
  it("falls back when the feed is down", async () => {
    const broken = (async () => {
      throw new Error("dns");
    }) as unknown as typeof fetch;

    const rate = await currentRate(source(broken), "NGN");
    assert.equal(rate.source, "fallback");
    assert.equal(rate.rate, FALLBACK);
  });

  it("falls back on a non-200", async () => {
    const rate = await currentRate(source(feed({}, 503)), "NGN");
    assert.equal(rate.source, "fallback");
  });

  it("falls back when the currency is absent", async () => {
    const rate = await currentRate(source(feed({ rates: { EUR: 0.9 } })), "NGN");
    assert.equal(rate.source, "fallback");
  });

  // A zero or negative rate divides a quote into nonsense or infinity.
  it("refuses a rate that is not a positive number", async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1300", null]) {
      clearRateCache();
      const rate = await currentRate(source(feed({ rates: { NGN: bad } })), "NGN");
      assert.equal(rate.source, "fallback", String(bad));
    }
  });

  // A feed reporting 1 NGN to the dollar would quote ₦50,000 at $50,000 of somebody's money.
  it("refuses a rate outside any plausible range", async () => {
    for (const absurd of [0.0001, 100_000_000]) {
      clearRateCache();
      const rate = await currentRate(source(feed({ rates: { NGN: absurd } })), "NGN");
      assert.equal(rate.source, "fallback", String(absurd));
    }
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("first one fails");
      return new Response(JSON.stringify({ rates: { NGN: 1300 } }), { status: 200 });
    }) as unknown as typeof fetch;

    assert.equal((await currentRate(source(flaky), "NGN")).source, "fallback");
    assert.equal((await currentRate(source(flaky), "NGN")).source, "live");
  });
});

describe("the gap the stale constant opened", () => {
  // At 1,534 a ₦50,000 transfer quotes a ceiling of about $33.25. Delivering it really costs about
  // $37.65, so no rational provider bids. This asserts the live path produces a fillable number.
  it("quotes a ceiling a provider can actually fill", async () => {
    const live = await currentRate(source(feed({ rates: { NGN: 1327.682521 } })), "NGN");

    const kobo = 5_000_000n;
    const costToProvider = (kobo * 1_000_000n) / (100n * live.rate);
    const atStaleRate = (kobo * 1_000_000n) / (100n * 1_534n);

    assert.ok(costToProvider > atStaleRate, "the stale rate understated the cost");
    // Roughly $37.65 against roughly $32.59.
    assert.ok(costToProvider > 37_000_000n && costToProvider < 38_000_000n);
  });
});
