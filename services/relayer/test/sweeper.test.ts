import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Account, Hex, PublicClient, WalletClient } from "viem";

import { dataDir } from "../src/config.ts";
import { SubmissionQueue } from "../src/nonce.ts";
import { decide, Sweeper } from "../src/sweeper.ts";

const ORDER = `0x${"ab".repeat(32)}` as Hex;
const CORE = "0x00000000000000000000000000000000000000c0";

/** A chain that answers the three reads the sweeper makes, and records what it was asked to send. */
function fakeChain(state: { status: number; canRefund: boolean; canFinalize: boolean }) {
  const sent: string[] = [];
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "getOrder"
        ? { status: state.status }
        : functionName === "canRefund"
          ? state.canRefund
          : state.canFinalize,
    estimateContractGas: async () => 90_000n,
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async ({ functionName, gas }: { functionName: string; gas: bigint }) => {
      sent.push(`${functionName}:${gas}`);
      return `0x${"11".repeat(32)}` as Hex;
    },
  } as unknown as WalletClient;
  return { publicClient, walletClient, sent };
}

function sweeperOn(chain: ReturnType<typeof fakeChain>) {
  const file = join(mkdtempSync(join(tmpdir(), "sweep-")), "sweep.json");
  const sweeper = new Sweeper({
    publicClient: chain.publicClient,
    walletClient: chain.walletClient,
    account: { address: "0x00000000000000000000000000000000000000aa" } as unknown as Account,
    railCore: CORE,
    queue: new SubmissionQueue(async () => 0),
    file,
    log: () => {},
  });
  return { sweeper, file };
}

describe("decide", () => {
  it("refunds an expired auction nobody bid on", () => {
    // The 8 Oct order: Open, past revealEnd, no winner. Left alone it sits in escrow forever.
    assert.equal(decide(1, true, false), "refund");
  });

  it("finalizes a paid order whose dispute window has passed", () => {
    assert.equal(decide(3, false, true), "finalize");
  });

  it("waits while a window is still open", () => {
    // Acting early would revert and waste the relayer's gas; the contract is the clock.
    assert.equal(decide(1, false, false), "wait");
    assert.equal(decide(2, false, false), "wait");
  });

  it("forgets anything already terminal, or unknown to this core", () => {
    for (const status of [0, 5, 6, 7]) assert.equal(decide(status, false, false), "forget");
  });
});

describe("Sweeper", () => {
  it("refunds a stuck order once and stops tracking it after it closes", async () => {
    const state = { status: 1, canRefund: true, canFinalize: false };
    const chain = fakeChain(state);
    const { sweeper, file } = sweeperOn(chain);

    sweeper.track(ORDER);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), [ORDER], "tracked ids must survive a restart");

    await sweeper.tick();
    assert.deepEqual(chain.sent, ["refund:130000"], "estimate plus a fixed margin, never the node default");

    state.status = 6;
    state.canRefund = false;
    await sweeper.tick();
    assert.equal(sweeper.size, 0);
    assert.equal(chain.sent.length, 1, "a refunded order is never touched again");
  });

  it("sends nothing for an order that is still running", async () => {
    const chain = fakeChain({ status: 1, canRefund: false, canFinalize: false });
    const { sweeper } = sweeperOn(chain);
    sweeper.track(ORDER);
    await sweeper.tick();
    assert.deepEqual(chain.sent, []);
    assert.equal(sweeper.size, 1);
  });

  it("reloads what it was tracking after a restart", () => {
    const chain = fakeChain({ status: 1, canRefund: false, canFinalize: false });
    const { sweeper, file } = sweeperOn(chain);
    sweeper.track(ORDER);

    const again = new Sweeper({
      publicClient: chain.publicClient,
      walletClient: chain.walletClient,
      account: { address: "0x00000000000000000000000000000000000000aa" } as unknown as Account,
      railCore: CORE,
      queue: new SubmissionQueue(async () => 0),
      file,
      log: () => {},
    });
    assert.equal(again.size, 1);
  });
});

describe("dataDir", () => {
  it("recovers the path Git Bash mangled, instead of writing off the volume", { skip: process.platform === "win32" }, () => {
    // Railway held VAULT_DIR=C:/Program Files/Git/data/vault; on Linux that is a relative directory
    // inside the container and every recipient in it vanished on redeploy.
    process.env.TEST_DATA_DIR = "C:/Program Files/Git/data/vault";
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(dataDir("TEST_DATA_DIR", ".vault"), "/data/vault");
      process.env.TEST_DATA_DIR = "D:/somewhere/else";
      assert.equal(dataDir("TEST_DATA_DIR", ".vault"), ".vault");
    } finally {
      console.error = original;
      delete process.env.TEST_DATA_DIR;
    }
  });

  it("passes an ordinary path through untouched", () => {
    process.env.TEST_DATA_DIR = "/data/vault";
    assert.equal(dataDir("TEST_DATA_DIR", ".vault"), "/data/vault");
    delete process.env.TEST_DATA_DIR;
  });
});
