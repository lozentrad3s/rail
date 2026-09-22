/**
 * One owner of the signer's nonce.
 *
 * Twenty senders can press confirm in the same second. If each submission asked the node for
 * `eth_getTransactionCount` it would get the same answer, and nineteen of the twenty transactions
 * would be rejected as duplicates — so the nonce is allocated here, in order, by one queue.
 */
import type { Hex } from "viem";

export type Submission = (nonce: number) => Promise<Hex>;

/**
 * Whether this failure means the transaction can never be mined under that nonce.
 *
 * "Nonce too low" says the account has already moved past it — something else spent it, and this
 * transaction was not included. That makes it safe to try again with a fresh number, which is not
 * true of every failure: "already known" or "underpriced" may mean a transaction is still pending,
 * and retrying those risks sending the same order twice.
 */
function isStaleNonce(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}` : String(error);
  return /nonce too low|nonce provided for the transaction/i.test(text);
}

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
      try {
        return await this.#sendWithNextNonce(send);
      } catch (error) {
        this.#next = undefined;
        if (!isStaleNonce(error)) throw error;

        // The count was behind the chain — something else used the signer, or a transaction was
        // replaced. That attempt can never be mined, so one retry on a freshly read nonce is safe,
        // and it is the difference between a sender seeing their transfer go and seeing it fail.
        return await this.#sendWithNextNonce(send).catch((retryError: unknown) => {
          this.#next = undefined;
          throw retryError;
        });
      }
    });

    // The chain must survive a rejection, or one failed order blocks all the rest.
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #sendWithNextNonce(send: Submission): Promise<Hex> {
    if (this.#next === undefined) this.#next = await this.#fetchNonce();
    const nonce = this.#next;
    this.#next += 1;
    return send(nonce);
  }

  /** Forces a re-read on the next submission. */
  resync(): void {
    this.#next = undefined;
  }
}
