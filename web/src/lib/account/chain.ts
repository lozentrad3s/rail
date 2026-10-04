// Chain access for the sender app. Kept out of `(sender)` and `components/sender` so those paths
// stay clean against the ban list in CLAUDE.md — see docs/INTERFACES.md §5.5.1.

import { createPublicClient, http, erc20Abi, formatUnits, type Address } from "viem";
import { monadTestnet } from "viem/chains";

/** AUSD, 6 decimals. Testnet address — docs/INTERFACES.md §1. */
export const SETTLEMENT_ASSET: Address = (process.env.NEXT_PUBLIC_SETTLEMENT_ASSET ||
  "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC") as Address;

/** RailCore: the escrow the authorisation names as its recipient. */
export const ESCROW: Address = (process.env.NEXT_PUBLIC_RAIL_CORE ||
  "0xfa8C88Ee0fCF869783F489cADB222750F576f221") as Address;

export const CHAIN_ID = monadTestnet.id;
const DECIMALS = 6;

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || monadTestnet.rpcUrls.default.http[0];

export const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });

/**
 * True while balances are play money.
 *
 * The UI says so on screen. Showing a test balance as if it were real dollars would be the kind of
 * dishonesty docs/DESIGN.md §1 exists to prevent.
 */
export const isPractice = monadTestnet.testnet === true;

/**
 * The account's spendable balance, in whole dollars and cents.
 *
 * A read needs no signature and no fee, so this works for an account that has never transacted.
 */
export async function readBalance(address: Address): Promise<{ units: bigint; dollars: number }> {
  const units = await client.readContract({
    address: SETTLEMENT_ASSET,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return { units, dollars: Number(formatUnits(units, DECIMALS)) };
}
