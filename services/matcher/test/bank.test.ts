import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Hex } from "viem";

import { narrationFor, SimulatedBank } from "../src/bank.ts";

const ORDER = "0xa8befd3864845c06b9ebd9f924b121bb949824c7afada40cbec42eda0d897d54" as Hex;
const OTHER = `0x${"cd".repeat(32)}` as Hex;
const dir = () => mkdtempSync(join(tmpdir(), "bank-"));

describe("simulated bank", () => {
  it("uses the same narration the relayer and the CRE workflow match on", () => {
    assert.equal(narrationFor(ORDER), "RAILA8BEFD38");
  });

  it("labels every credit as simulated", () => {
    // Attack on honesty: a simulated payout that reads like a real bank credit to whoever sees it.
    const credit = new SimulatedBank(dir()).pay(ORDER, "NGN", 10_000_000n);
    assert.equal(credit.simulated, true);
    assert.match(credit.reference, /^SIM-/);
  });

  it("answers only for the narration asked about, as a bank feed would", () => {
    // Attack: one order's payout being read as proof for another.
    const bank = new SimulatedBank(dir());
    bank.pay(ORDER, "NGN", 10_000_000n);
    assert.equal(bank.query(narrationFor(OTHER)).length, 0);
    assert.equal(bank.query(narrationFor(ORDER).toLowerCase(), "ngn").length, 1);
    assert.equal(bank.query(narrationFor(ORDER), "GHS").length, 0);
  });

  it("records one payout per order however often it is asked, and survives a restart", () => {
    const where = dir();
    const bank = new SimulatedBank(where);
    bank.pay(ORDER, "NGN", 10_000_000n);
    bank.pay(ORDER, "NGN", 99_000_000n);
    const again = new SimulatedBank(where);
    const credits = again.query(narrationFor(ORDER));
    assert.equal(credits.length, 1);
    assert.equal(credits[0]?.amountMinor, "10000000");
  });
});
