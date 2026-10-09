import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Account, Hex, PublicClient, WalletClient } from "viem";

import { RelayerError } from "../src/errors.ts";
import { AUSD_FAUCET, PracticeDollars, TESTNET_CHAIN_ID } from "../src/faucet.ts";
import { SubmissionQueue } from "../src/nonce.ts";

const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

function faucet(options: { chainId?: number; refuses?: boolean; clock?: { now: number } } = {}) {
  const sent: { to: string; recipient: string; gas: bigint }[] = [];
  const publicClient = {
    estimateContractGas: async () => {
      if (options.refuses) throw new Error("execution reverted");
      return 130_600n;
    },
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async ({ address, args, gas }: { address: string; args: [string]; gas: bigint }) => {
      sent.push({ to: address, recipient: args[0], gas });
      return `0x${"22".repeat(32)}` as Hex;
    },
  } as unknown as WalletClient;
  const clock = options.clock ?? { now: 1_000_000 };
  const dollars = new PracticeDollars({
    publicClient,
    walletClient,
    account: { address: "0x00000000000000000000000000000000000000aa" } as unknown as Account,
    queue: new SubmissionQueue(async () => 0),
    chainId: options.chainId ?? TESTNET_CHAIN_ID,
    now: () => clock.now,
  });
  return { dollars, sent, clock };
}

const code = (error: unknown) => (error instanceof RelayerError ? error.code : String(error));

describe("practice dollars", () => {
  it("asks Agora's faucet to pay the address, with the relayer paying only gas", async () => {
    const { dollars, sent } = faucet();
    await dollars.request({ address: ALICE });
    assert.deepEqual(sent, [{ to: AUSD_FAUCET, recipient: ALICE, gas: 170_600n }]);
  });

  it("refuses on any chain but the testnet", async () => {
    // Attack: point a mainnet relayer at this endpoint and have it spend real MON on nothing.
    const { dollars, sent } = faucet({ chainId: 143 });
    await assert.rejects(dollars.request({ address: ALICE }), (e) => code(e) === "BAD_REQUEST");
    assert.equal(sent.length, 0);
  });

  it("will not pay gas twice in a minute for the same address", async () => {
    // Attack: hammer the endpoint with one address to drain the relayer's gas.
    const { dollars, sent, clock } = faucet();
    await dollars.request({ address: ALICE });
    await assert.rejects(dollars.request({ address: ALICE.toUpperCase().replace("0X", "0x") }), (e) => code(e) === "RATE_LIMITED");
    clock.now += 60_001;
    await dollars.request({ address: ALICE });
    assert.equal(sent.length, 2);
  });

  it("caps total requests per minute whatever addresses are used", async () => {
    // Attack: rotate fresh addresses to get round the per-address limit.
    const { dollars, sent } = faucet();
    for (let i = 1; i <= 20; i++) await dollars.request({ address: `0x${i.toString(16).padStart(40, "0")}` });
    await assert.rejects(dollars.request({ address: BOB }), (e) => code(e) === "RATE_LIMITED");
    assert.equal(sent.length, 20);
  });

  it("reports the faucet's own refusal instead of paying for a reverted transaction", async () => {
    const { dollars, sent } = faucet({ refuses: true });
    await assert.rejects(dollars.request({ address: ALICE }), (e) => code(e) === "RATE_LIMITED");
    assert.equal(sent.length, 0);
  });

  it("rejects something that is not an address", async () => {
    const { dollars } = faucet();
    await assert.rejects(dollars.request({ address: "mum" }), (e) => code(e) === "BAD_REQUEST");
    await assert.rejects(dollars.request(null), (e) => code(e) === "BAD_REQUEST");
  });
});
