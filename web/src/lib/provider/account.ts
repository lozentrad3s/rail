/**
 * Whoever is acting as a provider, however they signed in.
 *
 * Two ways in — Dynamic (browser wallet, mobile wallet, or email) and the plain browser-extension
 * picker — and one shape out. Every protocol call on the provider page takes a viem WalletClient,
 * so the page asks this for one at the moment it needs to sign and never cares which door it was.
 */
import type { Address, WalletClient } from "viem";

import { forgetWallet, walletClientFor, type ConnectedWallet } from "@/lib/account/wallet";

export type ProviderAccount = {
  address: Address;
  source: "dynamic" | "browser";
  /** Shown beside the address, e.g. "MetaMask" or "Zerion". */
  label: string;
  /** Fetched per action, so a wallet that switched chain or account is asked again, not trusted. */
  walletClient: () => Promise<WalletClient>;
  signOut: () => Promise<void>;
};

export function browserAccount(wallet: ConnectedWallet, label = "Browser wallet"): ProviderAccount {
  return {
    address: wallet.address,
    source: "browser",
    label,
    walletClient: async () => walletClientFor(wallet),
    signOut: async () => forgetWallet(),
  };
}
