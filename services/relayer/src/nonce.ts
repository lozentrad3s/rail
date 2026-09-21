/**
 * One owner of the signer's nonce.
 *
 * Twenty senders can press confirm in the same second. If each submission asked the node for
 * `eth_getTransactionCount` it would get the same answer, and nineteen of the twenty transactions
 * would be rejected as duplicates — so the nonce is allocated here, in order, by one queue.
 */
import type { Hex } from "viem";

export type Submission = (nonce: number) => Promise<Hex>;

export class SubmissionQueue {
  readonly #fetchNonce: () => Promise<number>;
  #next: number | undefined;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(fetchNonce: () => Promise<number>) {
    this.#fetchNonce = fetchNonce;
  }

  /**
   * Runs `send` with the next nonce, after every submission queued before it.
   *
   * A failure resets the count so the next submission re-reads it from the chain rather than
   * inheriting a gap — a stuck nonce would silently wedge every later order.
   */
  async submit(send: Submission): Promise<Hex> {
    const run = this.#tail.then(async () => {
      if (this.#next === undefined) this.#next = await this.#fetchNonce();
      const nonce = this.#next;
      this.#next += 1;

      try {
        return await send(nonce);
      } catch (error) {
        this.#next = undefined;
        throw error;
      }
    });

    // The chain must survive a rejection, or one failed order blocks all the rest.
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** Forces a re-read on the next submission. */
  resync(): void {
    this.#next = undefined;
  }
}
