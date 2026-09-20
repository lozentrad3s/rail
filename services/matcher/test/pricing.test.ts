import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PriceError, StaticRate } from "../src/pricing.ts";

const ngn = () => new StaticRate(1_534n, 150n, ["NGN"]);

describe("StaticRate", () => {
  it("prices fifty thousand naira in dollars", () => {
    // ₦50,000 = 5,000,000 kobo. At ₦1,534/$ that is $32.5945; plus a 1.5% margin, $33.0834.
    // AUSD has 6 decimals and the result rounds up, so: 33,083,442 units.
    assert.equal(ngn().price("NGN", 5_000_000n), 33_083_442n);
  });

  it("makes a tighter spread always bid lower", () => {
    const tight = new StaticRate(1_534n, 50n, ["NGN"]);
    const wide = new StaticRate(1_534n, 300n, ["NGN"]);
    assert.ok(tight.price("NGN", 5_000_000n) < wide.price("NGN", 5_000_000n));
  });

  it("refuses a currency it cannot deliver", () => {
    assert.throws(() => ngn().price("GHS", 1_000n), PriceError);
  });

  it("never rounds down below its own price", () => {
    // One kobo must still cost at least one AUSD unit, never zero.
    assert.ok(ngn().price("NGN", 1n) > 0n);
  });

  it("stays exact on amounts that do not divide evenly", () => {
    // Integer maths only: two providers running the same numbers must agree to the unit.
    const odd = ngn().price("NGN", 3_333_333n);
    assert.equal(odd, ngn().price("NGN", 3_333_333n));
    assert.equal(typeof odd, "bigint");
  });
});
