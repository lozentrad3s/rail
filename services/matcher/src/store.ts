/**
 * Bid salts, written to disk before the commit is sent.
 *
 * A sealed bid is `keccak(orderId, lp, amount, salt)`. Lose the salt and the bid can never be
 * revealed: the collateral stays locked until the auction closes and the provider simply loses. So
 * the salt is persisted *before* the commit transaction goes out, never after.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";

export type SealedBid = {
  orderId: Hex;
  amount: bigint;
  salt: Hex;
};

export class StoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreError";
  }
}

export class Store {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
    try {
      mkdirSync(dir, { recursive: true });
    } catch (cause) {
      throw new StoreError(`could not open the bid store at ${dir}`, { cause });
    }
  }

  private pathFor(orderId: Hex): string {
    return join(this.#dir, `${orderId}.json`);
  }

  /** Records a bid and flushes it to disk before returning. The commit follows, never precedes. */
  remember(bid: SealedBid): void {
    try {
      // bigint has no JSON representation, so the amount is stored as a decimal string.
      const body = JSON.stringify(
        { orderId: bid.orderId, amount: bid.amount.toString(), salt: bid.salt },
        null,
        2,
      );
      writeFileSync(this.pathFor(bid.orderId), body, { flush: true });
    } catch (cause) {
      throw new StoreError(`could not persist the bid for ${bid.orderId}`, { cause });
    }
  }

  /** Recovers a bid after a restart, so an interrupted matcher can still reveal in time. */
  recall(orderId: Hex): SealedBid | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.pathFor(orderId), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new StoreError(`could not read the bid for ${orderId}`, { cause });
    }

    try {
      const parsed = JSON.parse(raw) as { orderId: Hex; amount: string; salt: Hex };
      return { orderId: parsed.orderId, amount: BigInt(parsed.amount), salt: parsed.salt };
    } catch (cause) {
      throw new StoreError(`the stored bid for ${orderId} is corrupt`, { cause });
    }
  }
}
