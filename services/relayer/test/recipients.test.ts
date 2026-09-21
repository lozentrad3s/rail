import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Hex } from "viem";

import { commitmentFor, RecipientStore, type Recipient } from "../src/recipients.ts";
import { narrationFor, orderIdFor } from "../src/orders.ts";

const KEY = `0x${"11".repeat(32)}` as Hex;
const ORDER = `0x${"ab".repeat(32)}` as Hex;

const recipient: Recipient = {
  bankCode: "058",
  accountNumber: "0001234567",
  accountName: "ADAEZE O. OKONKWO",
  salt: `0x${"cd".repeat(32)}` as Hex,
};

const withStore = (run: (store: RecipientStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "rail-recipients-"));
  try {
    run(new RecipientStore(dir, KEY), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("recipient commitments", () => {
  it("changes completely when the account number changes", () => {
    const other = commitmentFor({ ...recipient, accountNumber: "0001234568" });
    assert.notEqual(commitmentFor(recipient), other);
  });

  it("changes when the salt changes, which is what stops a brute force", () => {
    // A ten-digit account number has ten billion possibilities: guessable in seconds without salt.
    const resalted = commitmentFor({ ...recipient, salt: `0x${"ef".repeat(32)}` as Hex });
    assert.notEqual(commitmentFor(recipient), resalted);
  });

  it("is stable for the same details", () => {
    assert.equal(commitmentFor(recipient), commitmentFor({ ...recipient }));
  });
});

describe("RecipientStore", () => {
  it("returns what it was given", () => {
    withStore((store) => {
      store.put(ORDER, recipient);
      assert.deepEqual(store.get(ORDER), recipient);
    });
  });

  it("writes no bank details in the clear", () => {
    withStore((store, dir) => {
      store.put(ORDER, recipient);
      const onDisk = readdirSync(dir).map((file) => readFileSync(join(dir, file), "utf8")).join();

      // The whole point: a stolen file is not a list of bank accounts.
      assert.ok(!onDisk.includes("0001234567"), "the account number must not be readable");
      assert.ok(!onDisk.includes("ADAEZE"), "the account name must not be readable");
      assert.ok(!onDisk.includes("058"), "the bank code must not be readable");
    });
  });

  it("refuses details that were tampered with", () => {
    withStore((store, dir) => {
      store.put(ORDER, recipient);
      const file = join(dir, readdirSync(dir)[0] as string);
      const stored = JSON.parse(readFileSync(file, "utf8")) as { body: string };
      const flipped = Buffer.from(stored.body, "base64");
      flipped[0] = (flipped[0] ?? 0) ^ 0xff;

      writeFileSync(file, JSON.stringify({ ...stored, body: flipped.toString("base64") }));
      assert.throws(() => store.get(ORDER), /decrypted/);
    });
  });

  it("treats an unknown order as absent", () => {
    withStore((store) => assert.equal(store.get(ORDER), undefined));
  });
});

describe("narration", () => {
  it("is twelve alphanumeric characters, because banks mangle anything else", () => {
    const narration = narrationFor(ORDER);
    assert.match(narration, /^RAIL[0-9A-F]{8}$/);
    assert.equal(narration.length, 12);
  });

  it("differs between orders, so a payment can be matched to one", () => {
    assert.notEqual(narrationFor(ORDER), narrationFor(`0x${"12".repeat(32)}` as Hex));
  });
});

describe("order id", () => {
  it("changes if the relayer alters any field the sender signed", () => {
    const intent = {
      sender: "0xa9aa6E0226d8F593Dc3A3220E61B1e18326d4b65",
      recipientCommitment: commitmentFor(recipient),
      currency: "0x4e474e",
      localAmount: 5_000_000n,
      maxAusd: 33_600_000n,
      fee: 130_000n,
      relayer: "0x3dD62d5021cA5cA5439f87Be8772A21b9b662C2c",
      attestor: "0x2D6637D0F9C89648B39eF5f776E9923734C8CFdA",
      salt: `0x${"01".repeat(32)}`,
    } as const;
    const core = "0xf0A34887d703300FA73533678A4a1f9D3B68c27F";
    const original = orderIdFor(intent, 10143, core);

    // The order id is the EIP-3009 nonce, so a different id means the token rejects the signature.
    // This is invariant 9: one signature from the sender, and a relayer cannot alter it.
    assert.notEqual(orderIdFor({ ...intent, maxAusd: 99_000_000n }, 10143, core), original);
    assert.notEqual(orderIdFor({ ...intent, recipientCommitment: `0x${"99".repeat(32)}` }, 10143, core), original);
    assert.notEqual(orderIdFor({ ...intent, attestor: intent.relayer }, 10143, core), original);
    assert.notEqual(orderIdFor({ ...intent, fee: 9_000_000n }, 10143, core), original);
    assert.equal(orderIdFor({ ...intent }, 10143, core), original);
  });
});
