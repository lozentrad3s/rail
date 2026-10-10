"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { DynamicContextProvider, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors, isEthereumWallet } from "@dynamic-labs/ethereum";
import { monadTestnet } from "viem/chains";
import { LogIn } from "lucide-react";

import type { ProviderAccount } from "@/lib/provider/account";

/**
 * Dynamic, as the provider's way in.
 *
 * Our own connector finds browser extensions and nothing else: a provider on a phone saw "no wallet
 * found", and one without a wallet had no way to start at all. Dynamic covers both — browser
 * wallets, mobile wallets over WalletConnect, and email sign-in that creates a wallet the provider
 * holds. Whichever they use, what comes back is a viem WalletClient, and the protocol calls on the
 * provider page take exactly that. Rail never sees a key.
 *
 * Loaded on the provider route only. Senders never download it, and their passkey path is untouched
 * (CLAUDE.md: connect is the second door, not a replacement).
 */

export const DYNAMIC_ENVIRONMENT_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim() || "";

/** Monad testnet, declared here so the pilot does not depend on a dashboard toggle being right. */
const MONAD_TESTNET = {
  blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
  chainId: monadTestnet.id,
  chainName: monadTestnet.name,
  iconUrls: ["https://rail-pay.vercel.app/icon.svg"],
  name: monadTestnet.name,
  nativeCurrency: { ...monadTestnet.nativeCurrency, iconUrl: "https://rail-pay.vercel.app/icon.svg" },
  networkId: monadTestnet.id,
  rpcUrls: [...monadTestnet.rpcUrls.default.http],
  vanityName: "Monad Testnet",
};

export function DynamicRoot({ children }: { children: ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        appName: "Rail providers",
        walletConnectors: [EthereumWalletConnectors],
        overrides: { evmNetworks: [MONAD_TESTNET] },
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}

/**
 * Reports the Dynamic wallet to the provider page as a `ProviderAccount`, and `null` on sign-out.
 * Renders nothing; it exists because Dynamic's state is only readable inside its provider.
 */
export function DynamicAccountBridge({ onChange }: { onChange: (account: ProviderAccount | null) => void }) {
  const { primaryWallet, handleLogOut } = useDynamicContext();
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      report.current(null);
      return;
    }
    const wallet = primaryWallet;
    report.current({
      address: wallet.address as ProviderAccount["address"],
      source: "dynamic",
      label: wallet.connector?.name ?? "Dynamic",
      walletClient: async () => {
        // Every write goes to Monad testnet; a wallet left on another chain signs for nowhere.
        if (wallet.connector?.supportsNetworkSwitching?.()) {
          await wallet.switchNetwork(monadTestnet.id);
        }
        return wallet.getWalletClient(String(monadTestnet.id));
      },
      signOut: async () => {
        await handleLogOut();
      },
    });
  }, [primaryWallet, handleLogOut]);

  return null;
}

/** Opens Dynamic's sign-in: wallet, mobile wallet, or email. */
export function DynamicSignInButton({ disabled }: { disabled?: boolean }) {
  const { setShowAuthFlow } = useDynamicContext();
  return (
    <button
      type="button"
      onClick={() => setShowAuthFlow(true)}
      disabled={disabled}
      className="btn btn-primary clay-press w-full text-[1rem]"
    >
      <LogIn className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
      Sign in or connect a wallet
    </button>
  );
}
