/**
 * Bidding on one order, from sealed commit to marking the payout made.
 *
 * The windows are measured in blocks and they are short — five blocks to commit is about a second
 * and a half on Monad. Everything here is written so that being late fails loudly and cheaply
 * rather than silently losing a provider's collateral.
 */
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { Config } from "./config.ts";
import type { PriceSource } from "./pricing.ts";
import type { SimulatedBank } from "./bank.ts";
import { currencyCode, railCoreAbi, Status } from "./rail.ts";
import type { Store } from "./store.ts";
import type { GasFunction, Sender } from "./tx.ts";

export class AuctionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuctionError";
  }
}

/** What the bot decided about an order, so the outcome is visible in logs and tests. */
export type Outcome =
  /** Not a currency, size or attestor this provider accepts. */
  | { kind: "skipped"; why: string }
  /** Our price was above the sender's reserve. Someone cheaper should win. */
  | { kind: "priced-out"; bid: bigint; max: bigint }
  /** We were too slow: the commit window closed before the bid could be sent. */
  | { kind: "missed"; why: string; head: bigint }
  /** We bid and lost. No money moves, and the collateral is released. */
  | { kind: "lost"; winner: Address }
  /** We bid, won, and (unless a human must confirm first) marked the payout made. */
  | { kind: "won"; bid: bigint; markedPaid: boolean };

export type OrderCreated = {
  orderId: Hex;
  currency: Hex;
  localAmount: bigint;
  maxAusd: bigint;
  attestor: Address;
  commitEnd: bigint;
  revealEnd: bigint;
};

/**
 * The sealed commitment: `keccak(orderId, lp, amount, salt)`.
 *
 * It binds the bidder's address, which is what stops a rival copying a commitment out of a block
 * and revealing it as their own.
 */
export function commitmentFor(orderId: Hex, lp: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, address, uint256, bytes32"), [orderId, lp, amount, salt]),
  );
}

export type BidderDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  config: Config;
  prices: PriceSource;
  store: Store;
  sender: Sender;
  /**
   * The chain head, kept current by a subscription.
   *
   * Asking the RPC costs ~250ms, which is most of a Monad block — measured one block too slow to
   * make a five-block commit window. A pushed head makes every timing check free.
   */
  head: () => bigint;
  /**
   * Where a simulated payout is written when `autoConfirmPayout` is on. Absent, a win is only marked
   * paid — which is what the tests exercise and what no hosted bot should ever do.
   */
  bank?: SimulatedBank | undefined;
  log?: (event: string, detail: Record<string, unknown>) => void;
};

export class Bidder {
  readonly #deps: BidderDeps;

  constructor(deps: BidderDeps) {
    this.#deps = deps;
  }

  private log(event: string, detail: Record<string, unknown> = {}): void {
    this.#deps.log?.(event, detail);
  }

  /**
   * Confirms our commitment scheme matches the contract's before a single bid is placed.
   *
   * If these ever disagreed, every commit would be unrevealable and the collateral would sit locked
   * until the auction closed. Cheap to check once at startup; expensive to discover live.
   */
  async verifyCommitmentScheme(): Promise<void> {
    const { publicClient, config, account } = this.#deps;
    const orderId = `0x${"11".repeat(32)}` as Hex;
    const salt = `0x${"22".repeat(32)}` as Hex;
    const amount = 1_234_567n;

    const onChain = await publicClient.readContract({
      address: config.railCore,
      abi: railCoreAbi,
      functionName: "computeCommitment",
      args: [orderId, account, amount, salt],
    });
    const local = commitmentFor(orderId, account, amount, salt);

    if (onChain !== local) {
      throw new AuctionError(
        `commitment scheme disagrees with the contract: local ${local}, chain ${onChain}`,
      );
    }
  }

  /** Decides whether to bid, and if so runs the auction through to the end. */
  async handleOrder(event: OrderCreated): Promise<Outcome> {
    const { config, prices, store, account } = this.#deps;
    const currency = currencyCode(event.currency);

    if (!config.currencies.includes(currency)) return { kind: "skipped", why: "currency not supported" };
    if (event.maxAusd > config.maxOrderAusd) {
      return { kind: "skipped", why: "larger than this provider's limit" };
    }
    // The sender picks the attestor, so a provider must be free to refuse one it distrusts.
    if (config.attestorAllowlist.length > 0 && !config.attestorAllowlist.includes(event.attestor)) {
      return { kind: "skipped", why: "attestor not on the allowlist" };
    }

    let bid: bigint;
    try {
      bid = prices.price(currency, event.localAmount);
    } catch {
      return { kind: "skipped", why: "no price for this currency" };
    }
    if (bid > event.maxAusd) return { kind: "priced-out", bid, max: event.maxAusd };

    // A bid sent after the window closes is gas spent on a certain revert, so check first — against
    // the pushed head, which costs nothing.
    const sentAt = this.#deps.head();
    if (sentAt > event.commitEnd) {
      return { kind: "missed", why: "commit window closed before we could bid", head: sentAt };
    }

    const salt = randomSalt();
    // Persisted before the commit is sent: a lost salt is a lost bid.
    store.remember({ orderId: event.orderId, amount: bid, salt });

    const minedAt = await this.send("commitBid", [
      event.orderId,
      commitmentFor(event.orderId, account, bid, salt),
    ]);
    this.log("committed", {
      order: event.orderId,
      bid,
      sentAtBlock: sentAt,
      minedAtBlock: minedAt,
      commitEnd: event.commitEnd,
      blocksToSpare: event.commitEnd - minedAt,
    });

    await this.waitPast(event.commitEnd);
    await this.send("revealBid", [event.orderId, bid, salt]);
    this.log("revealed", { order: event.orderId, bid });

    await this.waitPast(event.revealEnd);

    const order = await this.#deps.publicClient.readContract({
      address: config.railCore,
      abi: railCoreAbi,
      functionName: "getOrder",
      args: [event.orderId],
    });

    if (order.winner.toLowerCase() !== account.toLowerCase()) {
      return { kind: "lost", winner: order.winner };
    }

    // Anyone may close an auction; the winner has the most reason to.
    if (order.status === Status.Open) await this.send("closeAuction", [event.orderId]);

    if (!config.autoConfirmPayout) {
      this.log("won-awaiting-payout", {
        order: event.orderId,
        bid: order.winningBid,
        note: "pay the recipient, then mark this order paid",
      });
      return { kind: "won", bid: order.winningBid, markedPaid: false };
    }

    // Testnet only, enforced at startup: write down the payout we would have made, labelled as
    // simulated, before claiming it on-chain. The CRE attestor checks this record, not our word.
    const credit = this.#deps.bank?.pay(event.orderId, currency, event.localAmount);
    if (credit) {
      this.log("simulated-payout", {
        order: event.orderId,
        narration: credit.narration,
        amountMinor: credit.amountMinor,
        currency,
        note: "SIMULATED: no naira moved",
      });
    }

    await this.send("markPaid", [event.orderId]);
    return { kind: "won", bid: order.winningBid, markedPaid: true };
  }

  /**
   * Sends and confirms, using gas limits and a nonce that were known before the auction started.
   *
   * Monad charges the declared limit rather than the gas used, so the limits in tx.ts are measured
   * from the contract test suite rather than guessed or estimated per call.
   */
  private async send(functionName: GasFunction, args: readonly unknown[]): Promise<bigint> {
    const hash = await this.#deps.sender.send(functionName, args);
    return this.#deps.sender.confirm(hash, functionName);
  }

  /**
   * Waits until the chain is past a window boundary. Windows are inclusive.
   *
   * Reads the pushed head rather than polling the RPC, so waiting costs nothing and the reveal
   * goes out on the first block that allows it.
   */
  private async waitPast(block: bigint): Promise<void> {
    const { head, publicClient } = this.#deps;
    for (;;) {
      if (head() > block) return;
      await new Promise((resolve) => setTimeout(resolve, 60));

      // If the subscription has stalled the head stops moving; fall back rather than hang.
      if (head() === 0n) {
        const current = await publicClient.getBlockNumber();
        if (current > block) return;
      }
    }
  }
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Buffer.from(bytes).toString("hex")}` as Hex;
}
