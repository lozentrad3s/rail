import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { priceTransfer } from "../src/quote.ts";

const base = {
  currency: "NGN",
  localAmountMinor: 5_000_000n, // ₦50,000
  rate: 1_534n,
  reserveBufferBps: 200n,
  feeAusd: 130_000n,
  ttlSeconds: 120,
  now: 1_700_000_000,
};

describe("priceTransfer", () => {
  it("prices fifty thousand naira and sets a reserve above it", () => {
    const quote = priceTransfer(base);

    // ₦50,000 at ₦1,534/$ is $32.5945241…, rounded up to $32.594525 so the sender is never quoted
    // less than the transfer is worth. A 2% buffer puts the reserve at $33.246416.
    assert.equal(quote.indicativeAusd, 32_594_525n);
    assert.equal(quote.maxAusd, 33_246_416n);
    assert.ok(quote.maxAusd > quote.indicativeAusd, "the reserve must leave room to bid");
  });

  it("expires, because a rate from ten minutes ago is not a price", () => {
    assert.equal(priceTransfer(base).expiresAt, base.now + 120);
  });

  it("never quotes less than the transfer is worth", () => {
    // One kobo still costs something, and rounding is always upward.
    const quote = priceTransfer({ ...base, localAmountMinor: 1n });
    assert.ok(quote.indicativeAusd > 0n);
    assert.ok(quote.maxAusd >= quote.indicativeAusd);
  });

  it("moves the reserve with the buffer, not with the fee", () => {
    const tight = priceTransfer({ ...base, reserveBufferBps: 50n });
    const loose = priceTransfer({ ...base, reserveBufferBps: 500n });
    assert.ok(tight.maxAusd < loose.maxAusd);

    const dearer = priceTransfer({ ...base, feeAusd: 900_000n });
    assert.equal(dearer.maxAusd, priceTransfer(base).maxAusd, "the fee is charged separately");
  });

  it("gets worse for the sender as the naira weakens", () => {
    const strong = priceTransfer({ ...base, rate: 1_000n });
    const weak = priceTransfer({ ...base, rate: 2_000n });
    assert.ok(weak.indicativeAusd < strong.indicativeAusd, "more naira per dollar costs fewer dollars");
  });
});
