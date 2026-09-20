import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";

import { commitmentFor } from "../src/auction.ts";
import { currencyCode } from "../src/rail.ts";
import { Store } from "../src/store.ts";

const ORDER = `0x${"11".repeat(32)}` as Hex;
const SALT = `0x${"22".repeat(32)}` as Hex;
const LP = "0x3dD62d5021cA5cA5439f87Be8772A21b9b662C2c" as const;

describe("sealed bids", () => {
  it("matches the contract's abi.encode exactly", () => {
    // RailCore computes keccak256(abi.encode(orderId, lp, amount, salt)). If this ever drifts,
    // every commit becomes unrevealable and the provider's collateral sits locked until close.
    const expected = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, address, uint256, bytes32"), [
        ORDER,
        LP,
        32_610_000n,
        SALT,
      ]),
    );
    assert.equal(commitmentFor(ORDER, LP, 32_610_000n, SALT), expected);
  });

  it("binds the bidder, so a copied commitment is useless to anyone else", () => {
    const mine = commitmentFor(ORDER, LP, 32_610_000n, SALT);
    const theirs = commitmentFor(ORDER, "0x000000000000000000000000000000000000dEaD", 32_610_000n, SALT);
    assert.notEqual(mine, theirs);
  });

  it("hides the amount until reveal", () => {
    const low = commitmentFor(ORDER, LP, 32_000_000n, SALT);
    const high = commitmentFor(ORDER, LP, 33_000_000n, SALT);
    assert.notEqual(low, high);
  });
});

describe("currency codes", () => {
  it("decodes bytes3 from the chain", () => {
    assert.equal(currencyCode("0x4e474e"), "NGN");
    assert.equal(currencyCode("0x474853"), "GHS");
  });

  it("trims the padding a bytes3 carries in a log topic", () => {
    assert.equal(currencyCode(`0x4e474e${"00".repeat(29)}`), "NGN");
  });
});

describe("the bid store", () => {
  it("survives a restart, because a lost salt is a lost bid", () => {
    const dir = mkdtempSync(join(tmpdir(), "rail-matcher-"));
    try {
      new Store(dir).remember({ orderId: ORDER, amount: 32_610_000n, salt: SALT });
      const recovered = new Store(dir).recall(ORDER);

      assert.equal(recovered?.amount, 32_610_000n);
      assert.equal(recovered?.salt, SALT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats an unknown order as absent rather than an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "rail-matcher-"));
    try {
      assert.equal(new Store(dir).recall(ORDER), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
