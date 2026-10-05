/**
 * The balance gate.
 *
 * A sender who links an account holding $20 and asks to send ₦100,000 is the most ordinary failure
 * in the whole flow, and before this it arrived as "this transfer would not go through" — a sentence
 * nobody can act on. These tests pin the two things that make it actionable: that the shortfall is
 * named, and that it is never confused with a transfer that is wrong for some other reason.
 *
 * The chain is stubbed. What is under test is the relayer's own arithmetic and ordering, and a real
 * node would only make these slower and flakier without testing anything more.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { createOrder, readBalance, type OrderDeps } from "../src/orders.ts";
import { RelayerError } from "../src/errors.ts";
import { commitmentFor, RecipientStore, type Recipient } from "../src/recipients.ts";

const SENDER = "0x1111111111111111111111111111111111111111";
const AUSD = "0x2222222222222222222222222222222222222222";
const RAIL = "0x3333333333333333333333333333333333333333";
const RELAYER = "0x4444444444444444444444444444444444444444";

const recipient: Recipient = {
  bankCode: "058",
  accountNumber: "0001234567",
  accountName: "ADAEZE O. OKONKWO",
  salt: `0x${"cd".repeat(32)}` as Hex,
};

const MAX_AUSD = 33_246_416n; // the reserve for ₦50,000
const FEE = 130_000n;
const REQUIRED = MAX_AUSD + FEE;

const intent = {
  sender: SENDER,
  recipientCommitment: commitmentFor(recipient),
  currency: "0x4e474e",
  localAmount: "5000000",
  maxAusd: MAX_AUSD.toString(),
  fee: FEE.toString(),
  relayer: RELAYER,
  attestor: "0x0000000000000000000000000000000000000000",
  salt: `0x${"ef".repeat(32)}`,
};

const authorization = {
  // Far enough ahead that the quote-expiry check passes and this test keeps working next year.
  validAfter: "0",
  validBefore: (Math.floor(Date.now() / 1000) + 3600).toString(),
  v: 27,
  r: `0x${"aa".repeat(32)}`,
  s: `0x${"bb".repeat(32)}`,
};

type Calls = { simulated: number; submitted: number };

/**
 * A relayer wired to a chain that holds `balance` and accepts everything else.
 *
 * `simulated` and `submitted` are counted because the point of checking the balance first is that
 * neither happens when it is short — a simulation is a round trip and a submission is real money.
 */
function depsHolding(balance: bigint, dir: string): { deps: OrderDeps; calls: Calls } {
  const calls: Calls = { simulated: 0, submitted: 0 };
  const account = privateKeyToAccount(`0x${"7".repeat(64)}` as Hex);

  const deps = {
    publicClient: {
      getChainId: async () => 10143,
      readContract: async () => balance,
      simulateContract: async () => {
        calls.simulated += 1;
        return {};
      },
    },
    walletClient: {
      writeContract: async () => {
        calls.submitted += 1;
        return `0x${"dd".repeat(32)}` as Hex;
      },
    },
    account,
    config: { ausd: AUSD, railCore: RAIL },
    recipients: new RecipientStore(dir, `0x${"11".repeat(32)}` as Hex),
    queue: { submit: async (send: (nonce: number) => Promise<Hex>) => send(0) },
  } as unknown as OrderDeps;

  return { deps, calls };
}

const withDeps = async (
  balance: bigint,
  run: (deps: OrderDeps, calls: Calls) => Promise<void>,
): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "rail-balance-"));
  try {
    const { deps, calls } = depsHolding(balance, dir);
    await run(deps, calls);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const body = { intent, authorization, recipient };

describe("the balance gate", () => {
  it("names the shortfall instead of saying the transfer would not go through", async () => {
    await withDeps(20_000_000n, async (deps) => {
      const error = await createOrder(deps, body).then(
        () => null,
        (caught: unknown) => caught,
      );

      assert.ok(error instanceof RelayerError);
      assert.equal(error.code, "INSUFFICIENT_BALANCE");
      // The numbers are what make it actionable: $33.376416 needed against $20 held.
      assert.deepEqual(error.data, { required: REQUIRED.toString(), available: "20000000" });
    });
  });

  it("puts the shortfall on the wire, where a bigint would not go", async () => {
    await withDeps(0n, async (deps) => {
      const error = (await createOrder(deps, body).catch((caught: unknown) => caught)) as RelayerError;
      const wire = JSON.parse(JSON.stringify(error));

      assert.equal(wire.error.code, "INSUFFICIENT_BALANCE");
      assert.equal(wire.error.data.required, REQUIRED.toString());
      assert.equal(wire.error.data.available, "0");
    });
  });

  it("neither simulates nor submits when the account is short", async () => {
    await withDeps(REQUIRED - 1n, async (deps, calls) => {
      await createOrder(deps, body).catch(() => {});
      assert.equal(calls.simulated, 0, "a round trip nobody needed");
      assert.equal(calls.submitted, 0, "gas spent on a transfer that cannot work");
    });
  });

  it("lets an account holding exactly the amount through, because it can pay", async () => {
    await withDeps(REQUIRED, async (deps, calls) => {
      const { orderId } = await createOrder(deps, body);
      assert.match(orderId, /^0x[0-9a-f]{64}$/);
      assert.equal(calls.submitted, 1);
    });
  });

  it("carries no data on the errors that have nothing to say", async () => {
    await withDeps(REQUIRED, async (deps) => {
      // Bank details that do not match what was signed: a different failure, and not one a number
      // helps with. Nothing but INSUFFICIENT_BALANCE may start attaching data.
      const error = (await createOrder(deps, {
        ...body,
        recipient: { ...recipient, accountNumber: "0009999999" },
      }).catch((caught: unknown) => caught)) as RelayerError;

      assert.equal(error.code, "COMMITMENT_MISMATCH");
      assert.equal(JSON.parse(JSON.stringify(error)).error.data, undefined);
    });
  });
});

describe("reading a balance", () => {
  it("returns a decimal string, so no precision is lost on the way out", async () => {
    await withDeps(123_456_789_012_345_678n, async (deps) => {
      const read = await readBalance(deps, SENDER);
      assert.equal(read.balance, "123456789012345678");
      // Past 2^53 this is the whole point: as a number it would come back as …680.
      assert.notEqual(Number(read.balance).toString(), read.balance);
    });
  });

  it("refuses something that is not an address rather than asking the chain about it", async () => {
    await withDeps(0n, async (deps) => {
      for (const bad of ["", "0x", SENDER.slice(0, -1), `${SENDER}00`, "not-an-address"]) {
        const error = (await readBalance(deps, bad).catch((caught: unknown) => caught)) as RelayerError;
        assert.equal(error.code, "BAD_REQUEST", `accepted ${JSON.stringify(bad)}`);
      }
    });
  });
});
