/**
 * Chain access for the provider pages.
 *
 * Separate from `lib/account/chain.ts` on purpose. That file exists to keep chain vocabulary out of
 * the sender paths; this one has no such constraint, because a provider arrived with a wallet and
 * calling it a wallet is the clearest thing we can do for them.
 */
import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

export const SETTLEMENT_ASSET: Address = (process.env.NEXT_PUBLIC_SETTLEMENT_ASSET ||
  "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC") as Address;

export const ESCROW: Address = (process.env.NEXT_PUBLIC_RAIL_CORE ||
  "0xfa8C88Ee0fCF869783F489cADB222750F576f221") as Address;

export const REGISTRY: Address = (process.env.NEXT_PUBLIC_LP_REGISTRY ||
  "0x4C10f838b44A67C09B368c744D0d281cB3407E09") as Address;

export const CHAIN_ID = monadTestnet.id;
export const AUSD_DECIMALS = 6;

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || monadTestnet.rpcUrls.default.http[0];

export const client = createPublicClient({
  chain: monadTestnet,
  transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }),
});

/** Monad produces a block roughly every 400ms, which is how a block count becomes a countdown. */
export const BLOCK_MS = 400;

export const blocksToSeconds = (blocks: bigint): number => Number(blocks) * (BLOCK_MS / 1000);
