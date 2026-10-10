import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Hex, PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { RelayerError } from "../src/errors.ts";
import { payoutDetails, type OrderDeps } from "../src/orders.ts";
import type { RecipientStore } from "../src/recipients.ts";

const ORDER = `0x${"cd".repeat(32)}` as Hex;
const winner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

/**
 * RailCore awards lazily: after the reveal window an order with a winner stays `Open` in storage
 * until the next write touches it. The chain here answers with exactly that stored state.
 */
function deps(state: { status: number; revealEnd: bigint; block: bigint }): OrderDeps {
  const publicClient = {
    getBlockNumber: async () => state.block,
    readContract: async () => ({
      status: state.status,
      winner: winner.address,
      revealEnd: state.revealEnd,
      currency: "0x4e474e",
      localAmount: 5_000_000n,
    }),
  } as unknown as PublicClient;
  const recipients = {
    get: () => ({ bankCode: "001", accountNumber: "0000000001", accountName: "Test Recipient" }),
  } as unknown as RecipientStore;
  return { publicClient, recipients, config: { railCore: "0x00000000000000000000000000000000000000c0" } } as unknown as OrderDeps;
}

async function ask(signer: typeof winner, d: OrderDeps) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage({ message: `Rail payout details\norder: ${ORDER}\nissuedAt: ${issuedAt}` });
  return payoutDetails(d, ORDER, { lp: signer.address, issuedAt, signature });
}

const notWinner = (error: unknown) => error instanceof RelayerError && error.code === "NOT_WINNER";

describe("payout details", () => {
  // A provider who won on the page asked before anyone had written to the order, and was told they
  // were not the provider — so they could never see where to pay.
  it("gives the winner the details once the reveal window has closed, though storage still says Open", async () => {
    const details = await ask(winner, deps({ status: 1, revealEnd: 100n, block: 101n }));
    assert.equal(details.accountNumber, "0000000001");
  });

  // The leading bid can still be beaten while reveals are open, so nobody is the winner yet.
  it("refuses while the reveal window is still open", async () => {
    await assert.rejects(ask(winner, deps({ status: 1, revealEnd: 100n, block: 100n })), notWinner);
  });

  // Somebody else signs correctly for their own address, but did not win.
  it("refuses a provider that did not win", async () => {
    await assert.rejects(ask(stranger, deps({ status: 2, revealEnd: 100n, block: 150n })), notWinner);
  });

  it("still serves an order already awarded or paid in storage", async () => {
    for (const status of [2, 3, 4]) {
      const details = await ask(winner, deps({ status, revealEnd: 100n, block: 150n }));
      assert.equal(details.accountName, "Test Recipient");
    }
  });
});
