/**
 * Tests for the attestation rule.
 *
 * Every case here is money. An attestation that fires wrongly releases a sender's escrow to a
 * provider who never paid; one that fails to fire costs nothing but time, because `RailCore`'s
 * optimistic window still settles the order (Rail invariant 8). So the bias under test is:
 * refuse unless the bank clearly says otherwise.
 */
import { describe, expect } from "bun:test";
import { newTestRuntime, test } from "@chainlink/cre-sdk/test";

import { initWorkflow, matchCredit, type Config, type Credit } from "./main";

/** ₦50,000 in kobo. */
const OWED = "5000000";

const WANTED = { narration: "RAILA8BEFD38", currency: "NGN", expectedMinor: OWED };

const credit = (overrides: Partial<Credit> = {}): Credit => ({
  reference: "MONO-CR-8841207",
  narration: "RAILA8BEFD38",
  amountMinor: OWED,
  currency: "NGN",
  status: "successful",
  ...overrides,
});

describe("a payout that happened", () => {
  test("is matched", () => {
    expect(matchCredit([credit()], WANTED)?.reference).toBe("MONO-CR-8841207");
  });

  // A provider who sends more than they owe has still delivered.
  test("is matched when the provider overpaid", () => {
    expect(matchCredit([credit({ amountMinor: "6000000" })], WANTED)).toBeDefined();
  });

  // Banks are inconsistent about case and padding in a narration; senders are not at fault for it.
  test("is matched despite case and whitespace differences", () => {
    expect(matchCredit([credit({ narration: "  raila8befd38 " })], WANTED)).toBeDefined();
  });

  // Aggregators report amounts as either JSON numbers or strings.
  test("is matched when the amount arrives as a number", () => {
    expect(matchCredit([credit({ amountMinor: 5_000_000 })], WANTED)).toBeDefined();
  });

  test("is found among unrelated credits", () => {
    const others = [
      credit({ narration: "RAILOTHER1", reference: "x1" }),
      credit({ narration: "RAILOTHER2", reference: "x2" }),
    ];
    expect(matchCredit([...others, credit()], WANTED)?.reference).toBe("MONO-CR-8841207");
  });
});

describe("a payout that did not happen", () => {
  test("no credits at all is not a payout", () => {
    expect(matchCredit([], WANTED)).toBeUndefined();
  });

  // The single most costly false positive: attesting a short payment releases the full escrow.
  test("one kobo short is not a payout", () => {
    expect(matchCredit([credit({ amountMinor: "4999999" })], WANTED)).toBeUndefined();
  });

  // "pending" can still be reversed by the bank. Only settled money counts.
  test("pending is not a payout", () => {
    expect(matchCredit([credit({ status: "pending" })], WANTED)).toBeUndefined();
    expect(matchCredit([credit({ status: "reversed" })], WANTED)).toBeUndefined();
    expect(matchCredit([credit({ status: "failed" })], WANTED)).toBeUndefined();
  });

  // Somebody else's transfer of the same amount on the same day must not settle this order.
  test("the right amount under the wrong reference is not a payout", () => {
    expect(matchCredit([credit({ narration: "RAILSOMEONEELSE" })], WANTED)).toBeUndefined();
  });

  // ₦50,000 is not $50,000.
  test("the right number in the wrong currency is not a payout", () => {
    expect(matchCredit([credit({ currency: "USD" })], WANTED)).toBeUndefined();
  });

  // A reference that merely contains ours is a different reference.
  test("a reference that only resembles ours is not a payout", () => {
    expect(matchCredit([credit({ narration: "RAILA8BEFD388" })], WANTED)).toBeUndefined();
    expect(matchCredit([credit({ narration: "XRAILA8BEFD38" })], WANTED)).toBeUndefined();
  });
});

describe("amounts too large for a JavaScript number", () => {
  // Kobo amounts are integers in a currency with ~1,500 to the dollar. A large corporate payout
  // exceeds Number.MAX_SAFE_INTEGER, and float arithmetic here would be somebody's money.
  test("compare exactly, not approximately", () => {
    const huge = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    const justUnder = "9007199254740992"; // MAX_SAFE_INTEGER + 1

    expect(matchCredit([credit({ amountMinor: huge })], { ...WANTED, expectedMinor: huge })).toBeDefined();
    expect(
      matchCredit([credit({ amountMinor: justUnder })], { ...WANTED, expectedMinor: huge }),
    ).toBeUndefined();
  });
});

describe("initWorkflow", () => {
  const config: Config = { bankApiUrl: "http://127.0.0.1:8795/credits", authorizedKeys: [] };

  test("registers exactly one HTTP handler", () => {
    const handlers = initWorkflow(config);
    expect(handlers).toBeArray();
    expect(handlers).toHaveLength(1);
  });

  // An empty allowlist is fine in simulation and must never reach a deployed workflow: a public
  // attestation endpoint is an oracle anyone can ask leading questions of.
  test("carries the authorized keys it was given", () => {
    const keys = [{ type: "KEY_TYPE_ECDSA_EVM" as const, publicKey: "0xabc" }];
    const handlers = initWorkflow({ ...config, authorizedKeys: keys });
    expect(handlers[0].trigger.config.authorizedKeys).toHaveLength(1);
  });

  test("a runtime can be constructed for it", () => {
    const runtime = newTestRuntime();
    runtime.config = config;
    expect(runtime.config.bankApiUrl).toBe(config.bankApiUrl);
  });
});
