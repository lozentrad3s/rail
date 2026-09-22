import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Hex } from "viem";

import { SubmissionQueue } from "../src/nonce.ts";

describe("SubmissionQueue", () => {
  it("gives twenty concurrent submissions twenty distinct nonces", async () => {
    // The acceptance criterion from docs/INTERFACES.md §5.1. Asking the node per request would
    // hand the same nonce to all twenty and nineteen would be rejected as duplicates.
    const queue = new SubmissionQueue(async () => 7);
    const used: number[] = [];

    const hashes = await Promise.all(
      Array.from({ length: 20 }, () =>
        queue.submit(async (nonce) => {
          used.push(nonce);
          // Yield, so an implementation that allocated before awaiting would collide here.
          await new Promise((resolve) => setTimeout(resolve, 1));
          return `0x${nonce.toString(16).padStart(64, "0")}` as Hex;
        }),
      ),
    );

    assert.equal(new Set(used).size, 20, "every submission must get its own nonce");
    assert.deepEqual([...used].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => 7 + i));
    assert.equal(new Set(hashes).size, 20);
  });

  it("reads the nonce from the chain only once while things are working", async () => {
    let reads = 0;
    const queue = new SubmissionQueue(async () => {
      reads += 1;
      return 100;
    });

    for (let i = 0; i < 5; i++) await queue.submit(async () => "0xabc" as Hex);
    assert.equal(reads, 1);
  });

  it("re-reads after a failure rather than inheriting a gap", async () => {
    let reads = 0;
    const queue = new SubmissionQueue(async () => {
      reads += 1;
      return 42;
    });

    // Deliberately not a nonce error: this is about any failure forcing a re-read. A stale nonce
    // has its own behaviour, covered below.
    await assert.rejects(queue.submit(async () => Promise.reject(new Error("node unreachable"))));
    const seen: number[] = [];
    await queue.submit(async (nonce) => {
      seen.push(nonce);
      return "0xok" as Hex;
    });

    assert.equal(reads, 2, "a failure must force a re-read");
    assert.deepEqual(seen, [42]);
  });

  it("keeps working after one submission fails", async () => {
    const queue = new SubmissionQueue(async () => 1);

    await assert.rejects(queue.submit(async () => Promise.reject(new Error("boom"))));
    // A rejected promise in the chain must not wedge every later order.
    const hash = await queue.submit(async () => "0xstill-here" as Hex);
    assert.equal(hash, "0xstill-here");
  });
});

describe("recovering from a nonce the chain has moved past", () => {
  // Something else used the signer between reading the count and sending. That attempt can never
  // be mined, so the sender should not be told their transfer failed.
  it("re-reads and tries once more", async () => {
    let onChain = 5;
    const seen: number[] = [];
    const queue = new SubmissionQueue(async () => onChain);

    const hash = await queue.submit(async (nonce) => {
      seen.push(nonce);
      if (nonce === 5) {
        onChain = 9; // the chain moved on while this was in flight
        throw new Error("Nonce provided for the transaction (5) is lower than the current nonce");
      }
      return `0x${"ab".repeat(32)}`;
    });

    assert.deepEqual(seen, [5, 9], "it should retry on the nonce the chain actually has");
    assert.match(hash, /^0xab/);
  });

  // One retry, not a loop: a node that always says this is a node to stop talking to.
  it("gives up after one retry", async () => {
    let attempts = 0;
    const queue = new SubmissionQueue(async () => 1);

    await assert.rejects(
      queue.submit(async () => {
        attempts += 1;
        throw new Error("nonce too low");
      }),
      /nonce too low/,
    );
    assert.equal(attempts, 2);
  });

  // Retrying these could send the same order twice — the first may still be pending.
  it("never retries a failure that might have been accepted", async () => {
    for (const message of ["already known", "replacement transaction underpriced", "insufficient funds"]) {
      let attempts = 0;
      const queue = new SubmissionQueue(async () => 1);

      await assert.rejects(
        queue.submit(async () => {
          attempts += 1;
          throw new Error(message);
        }),
      );
      assert.equal(attempts, 1, message);
    }
  });

  it("leaves the queue usable afterwards", async () => {
    let onChain = 3;
    const queue = new SubmissionQueue(async () => onChain);

    await assert.rejects(queue.submit(async () => {
      throw new Error("insufficient funds");
    }));

    onChain = 4;
    const seen: number[] = [];
    await queue.submit(async (nonce) => {
      seen.push(nonce);
      return `0x${"cd".repeat(32)}`;
    });
    assert.deepEqual(seen, [4], "a failure must not wedge every later order");
  });
});
