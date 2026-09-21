import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAmount } from "../src/amounts.ts";

describe("reading an amount", () => {
  it("reads the ways a person writes fifty thousand naira", () => {
    for (const written of ["50k", "50K", "50,000", "50000", "₦50,000", "₦50000", "n50000", "ngn 50000", "50 000", "50000 naira"]) {
      assert.equal(parseAmount(written), 5_000_000n, written);
    }
  });

  it("scales a fraction with its suffix", () => {
    assert.equal(parseAmount("2.5k"), 250_000n);
    assert.equal(parseAmount("1.5m"), 150_000_000n);
    assert.equal(parseAmount("50.25"), 5_025n);
  });

  it("keeps kobo exact", () => {
    // A float would make this 5024.999999999999.
    assert.equal(parseAmount("50.25"), 5_025n);
    assert.equal(parseAmount("0.01"), 1n);
  });

  it("refuses anything that is not an amount", () => {
    for (const written of ["", "mum", "50k50", "k", "₦", "1e5", "-50", "50.0.0", "fifty"]) {
      assert.equal(parseAmount(written), undefined, written);
    }
  });

  it("refuses precision finer than a kobo rather than silently truncating it", () => {
    assert.equal(parseAmount("50.256"), undefined);
    // Trailing zeros carry no value, so they are fine.
    assert.equal(parseAmount("50.250"), 5_025n);
  });
});
