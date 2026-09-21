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

    await assert.rejects(queue.submit(async () => Promise.reject(new Error("nonce too low"))));
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
