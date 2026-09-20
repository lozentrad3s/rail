/**
 * Sending transactions fast enough to win an auction.
 *
 * The commit window is five blocks — about a second and a half. Measured against the public Monad
 * RPC from a laptop, the calls a naive send makes cost roughly: getLogs 550ms, estimateGas 250ms,
 * getTransactionCount 250ms, gas price 250ms, then the send itself. That is the entire window spent
 * on round trips before the bid is even broadcast, which is exactly how the first live run failed.
 *
 * So everything that can be known in advance is known in advance: gas limits are measured from the
 * contract's own test suite, the nonce is tracked locally, and fees are refreshed in the
 * background. What is left on the hot path is one signed send.
 */
import type { Abi, Account, Address, Hex, PublicClient, WalletClient } from "viem";

/**
 * Measured with `forge test --gas-report`, then given headroom.
 *
 * Monad charges the declared limit rather than the gas used, so these are deliberately close to the
 * real cost: too low and the bid reverts, too high and the provider burns MON on every bid.
 */
export const GAS_LIMITS = {
  commitBid: 120_000n, // measured max 79,851
  revealBid: 200_000n, // measured max 128,048 — it also locks collateral
  closeAuction: 90_000n, // measured max 52,664
  markPaid: 90_000n, // measured max 55,779
} as const;

export type GasFunction = keyof typeof GAS_LIMITS;

export class SendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SendError";
  }
}

export type SenderDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  address: Address;
  abi: Abi;
  contract: Address;
  /** How often to refresh the cached fee, in milliseconds. */
  feeRefreshMs?: number;
};

export class Sender {
  readonly #deps: SenderDeps;
  #nonce = 0;
  #fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: SenderDeps) {
    this.#deps = deps;
  }

  /** Fetches the nonce and fees once, before any auction is live. */
  async prime(): Promise<void> {
    const { publicClient, address, feeRefreshMs = 5_000 } = this.#deps;
    this.#nonce = await publicClient.getTransactionCount({ address, blockTag: "pending" });
    await this.#refreshFees();

    this.#timer = setInterval(() => {
      void this.#refreshFees().catch(() => {
        // A stale fee is survivable; a crashed bot is not.
      });
    }, feeRefreshMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  async #refreshFees(): Promise<void> {
    const fees = await this.#deps.publicClient.estimateFeesPerGas();
    this.#fees = {
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  }

  /**
   * Signs and broadcasts, using only what is already cached. Returns the hash without waiting for
   * inclusion — the caller decides whether it needs the receipt.
   */
  async send(functionName: GasFunction, args: readonly unknown[]): Promise<Hex> {
    const { walletClient, account, abi, contract } = this.#deps;
    if (!this.#fees) throw new SendError("sender was not primed");

    try {
      return await walletClient.writeContract({
        address: contract,
        abi,
        functionName,
        args: args as never,
        account,
        chain: null,
        gas: GAS_LIMITS[functionName],
        nonce: this.#nonce++,
        maxFeePerGas: this.#fees.maxFeePerGas,
        maxPriorityFeePerGas: this.#fees.maxPriorityFeePerGas,
      });
    } catch (cause) {
      // A nonce that has drifted (a restart, a transaction sent elsewhere) is recoverable: resync
      // from the chain and let the caller retry rather than wedging every later bid.
      if (/nonce/i.test(String(cause))) {
        this.#nonce = await this.#deps.publicClient.getTransactionCount({
          address: this.#deps.address,
          blockTag: "pending",
        });
      }
      throw new SendError(`${functionName} could not be sent`, { cause });
    }
  }

  /** Waits for inclusion, fails loudly on a revert, and reports the block it landed in. */
  async confirm(hash: Hex, functionName: string): Promise<bigint> {
    const receipt = await this.#deps.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new SendError(`${functionName} reverted in block ${receipt.blockNumber}`);
    }
    return receipt.blockNumber;
  }
}
