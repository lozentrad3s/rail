/**
 * Practice dollars, on the testnet only.
 *
 * Agora's AUSD faucet will send anyone 10,000 test dollars, but the call costs MON, and the people
 * who most need practice dollars have none: every Face ID account starts empty of both, and a judge
 * arriving with a wallet that holds only MON was stuck at "you need $76 more" with no way forward.
 *
 * So the relayer makes the call for them. It pays gas and nothing else — the dollars come from
 * Agora's faucet, straight to the address asked for, and never pass through Rail. On any chain but
 * the testnet this refuses, because there is no such thing as practice money on mainnet.
 */
import { isAddress, parseAbi, type Account, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

import { RelayerError } from "./errors.ts";
import type { SubmissionQueue } from "./nonce.ts";

export const TESTNET_CHAIN_ID = 10_143;

/** Agora's faucet on Monad testnet. Not ours — docs/DEPLOYMENTS.md. */
export const AUSD_FAUCET: Address = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";

const faucetAbi = parseAbi(["function requestFunds(address recipient)"]);

/** The faucet call was measured at 156,720 charged against a 130,600 estimate. */
const GAS_MARGIN = 40_000n;

/** The faucet already limits each address to once a minute; this stops us paying gas to hear it. */
const PER_ADDRESS_MS = 60_000;
/** A ceiling on how much MON a stranger can make the relayer spend, whatever addresses they use. */
const PER_MINUTE = 20;

export type FaucetDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  queue: SubmissionQueue;
  chainId: number;
  now?: () => number;
};

export class PracticeDollars {
  readonly #deps: FaucetDeps;
  readonly #lastByAddress = new Map<string, number>();
  #recent: number[] = [];

  constructor(deps: FaucetDeps) {
    this.#deps = deps;
  }

  async request(body: unknown): Promise<{ txHash: Hex }> {
    const { publicClient, walletClient, account, queue, chainId } = this.#deps;
    if (chainId !== TESTNET_CHAIN_ID) {
      throw new RelayerError("BAD_REQUEST", "Practice dollars exist only on the test network.");
    }

    const raw = (body as { address?: unknown } | null)?.address;
    if (typeof raw !== "string" || !isAddress(raw, { strict: false })) {
      throw new RelayerError("BAD_REQUEST", "address is not an address.");
    }
    const address = raw as Address;
    const key = address.toLowerCase();

    const now = (this.#deps.now ?? Date.now)();
    this.#recent = this.#recent.filter((at) => now - at < 60_000);
    const last = this.#lastByAddress.get(key);
    if ((last !== undefined && now - last < PER_ADDRESS_MS) || this.#recent.length >= PER_MINUTE) {
      throw new RelayerError("RATE_LIMITED", "Practice dollars were just sent. Try again in a minute.");
    }

    // Simulated first: the faucet refuses an address that already holds its maximum, and that is a
    // limit to report, not a failed transaction to pay for.
    let gas: bigint;
    try {
      gas = await publicClient.estimateContractGas({
        address: AUSD_FAUCET,
        abi: faucetAbi,
        functionName: "requestFunds",
        args: [address],
        account,
      });
    } catch (cause) {
      throw new RelayerError(
        "RATE_LIMITED",
        "The practice faucet said no. It allows one top-up a minute and caps how much one account can hold.",
        { cause },
      );
    }

    this.#lastByAddress.set(key, now);
    this.#recent.push(now);

    const txHash = await queue
      .submit((nonce) =>
        walletClient.writeContract({
          address: AUSD_FAUCET,
          abi: faucetAbi,
          functionName: "requestFunds",
          args: [address],
          account,
          chain: null,
          gas: gas + GAS_MARGIN,
          nonce,
        }),
      )
      .catch((cause: unknown) => {
        this.#lastByAddress.delete(key);
        throw new RelayerError("SUBMISSION_FAILED", "Could not request practice dollars. Try again.", { cause });
      });

    return { txHash };
  }
}
