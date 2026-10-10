/**
 * A provider's side of the protocol.
 *
 * Until now the only way to be a provider was to run `rail-matcher` with a private key in an env
 * file. That works for a bot and it is useless for a bureau de change in Lagos, who will not run a
 * Node process and should not have to. This is the same seven calls, from a page.
 *
 * Everything here is the provider's own wallet acting for itself. Rail holds no provider key, takes
 * no custody, and cannot bid, pay or confirm on anyone's behalf.
 */
import { erc20Abi, parseAbi, type Address, type Hex, type WalletClient } from "viem";

import { client, ESCROW, REGISTRY, SETTLEMENT_ASSET } from "./chain";

export const registryAbi = parseAbi([
  "function stake(uint256 amount)",
  "function requestUnstake(uint256 amount)",
  "function withdraw()",
  "function accountOf(address lp) view returns (uint256 staked, uint256 locked, uint256 pendingUnstake, uint64 unlockAt)",
  "function freeStake(address lp) view returns (uint256)",
  "function isEligible(address lp) view returns (bool)",
  "function minStake() view returns (uint256)",
  "struct Stats { uint64 commits; uint64 reveals; uint64 wins; uint64 settled; uint64 defaults; uint128 volumeSettled; }",
  "function statsOf(address lp) view returns (Stats)",
]);

export const coreAbi = parseAbi([
  "function commitBid(bytes32 orderId, bytes32 commitment)",
  "function revealBid(bytes32 orderId, uint256 amount, bytes32 salt)",
  "function markPaid(bytes32 orderId)",
  "function collateralBps() view returns (uint16)",
]);

export type Standing = {
  staked: bigint;
  locked: bigint;
  free: bigint;
  pendingUnstake: bigint;
  unlockAt: bigint;
  eligible: boolean;
  minStake: bigint;
  /** Derived, never written: `RailCore` increments these and nothing can set them. */
  stats: {
    commits: bigint;
    reveals: bigint;
    wins: bigint;
    settled: bigint;
    defaults: bigint;
    volumeSettled: bigint;
  };
};

export async function readStanding(lp: Address): Promise<Standing> {
  const [account, free, eligible, minStake, stats] = await Promise.all([
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "accountOf", args: [lp] }),
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "freeStake", args: [lp] }),
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "isEligible", args: [lp] }),
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "minStake" }),
    client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "statsOf", args: [lp] }),
  ]);

  const [staked, locked, pendingUnstake, unlockAt] = account;

  return {
    staked,
    locked,
    free,
    pendingUnstake,
    unlockAt: BigInt(unlockAt),
    eligible,
    minStake,
    stats: {
      commits: BigInt(stats.commits),
      reveals: BigInt(stats.reveals),
      wins: BigInt(stats.wins),
      settled: BigInt(stats.settled),
      defaults: BigInt(stats.defaults),
      volumeSettled: BigInt(stats.volumeSettled),
    },
  };
}

/** What this provider could still win, given what is already locked against open orders. */
export function headroom(standing: Standing, collateralBps: bigint): bigint {
  if (collateralBps === 0n) return 0n;
  return (standing.free * 10_000n) / collateralBps;
}

export async function readAllowance(lp: Address): Promise<bigint> {
  return client.readContract({
    address: SETTLEMENT_ASSET,
    abi: erc20Abi,
    functionName: "allowance",
    args: [lp, REGISTRY],
  });
}

/**
 * Approves exactly the amount being staked, never an unlimited allowance.
 *
 * An open allowance on a registry is an allowance somebody eventually finds a way to spend, and a
 * provider's stake is their working capital.
 */
export async function approveStake(wallet: WalletClient, lp: Address, amount: bigint): Promise<Hex> {
  return wallet.writeContract({
    chain: null,
    // The client's own signer when it has one (a Dynamic email wallet does); the address otherwise.
    account: wallet.account ?? lp,
    address: SETTLEMENT_ASSET,
    abi: erc20Abi,
    functionName: "approve",
    args: [REGISTRY, amount],
  });
}

export async function stake(wallet: WalletClient, lp: Address, amount: bigint): Promise<Hex> {
  return wallet.writeContract({
    chain: null,
    account: wallet.account ?? lp,
    address: REGISTRY,
    abi: registryAbi,
    functionName: "stake",
    args: [amount],
  });
}

export async function commitBid(
  wallet: WalletClient,
  lp: Address,
  orderId: Hex,
  commitment: Hex,
): Promise<Hex> {
  return wallet.writeContract({
    chain: null,
    account: wallet.account ?? lp,
    address: ESCROW,
    abi: coreAbi,
    functionName: "commitBid",
    args: [orderId, commitment],
  });
}

export async function revealBid(
  wallet: WalletClient,
  lp: Address,
  orderId: Hex,
  amount: bigint,
  salt: Hex,
): Promise<Hex> {
  return wallet.writeContract({
    chain: null,
    account: wallet.account ?? lp,
    address: ESCROW,
    abi: coreAbi,
    functionName: "revealBid",
    args: [orderId, amount, salt],
  });
}

/**
 * Confirms the naira went out.
 *
 * Only the winner can call it, and only before the payout deadline. It opens the dispute window
 * rather than releasing the money, so confirming is a claim, not a payment to itself.
 */
export async function markPaid(wallet: WalletClient, lp: Address, orderId: Hex): Promise<Hex> {
  return wallet.writeContract({
    chain: null,
    account: wallet.account ?? lp,
    address: ESCROW,
    abi: coreAbi,
    functionName: "markPaid",
    args: [orderId],
  });
}

export async function readCollateralBps(): Promise<bigint> {
  return BigInt(
    await client.readContract({ address: ESCROW, abi: coreAbi, functionName: "collateralBps" }),
  );
}
