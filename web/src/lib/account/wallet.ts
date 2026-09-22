/**
 * Connecting a wallet the sender already has.
 *
 * Deliberately dependency-free: viem speaks EIP-1193, every injected wallet provides EIP-1193, and
 * a connect modal from a vendor is a large amount of code and a large amount of trust for something
 * that is three RPC calls. WalletConnect can go on top later without changing anything below.
 *
 * Nothing here ever sends a transaction. The only thing it asks a wallet to do is sign the same
 * EIP-712 authorisation a passkey signs, so the escrow cannot tell the two apart.
 */
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { monadTestnet } from "viem/chains";

import { CHAIN_ID } from "./chain";

const STORAGE_KEY = "rail.connected.v1";

export type WalletFailure =
  | "no-wallet"
  | "rejected"
  | "wrong-network"
  | "network-add-failed"
  | "unknown";

export class WalletError extends Error {
  readonly reason: WalletFailure;

  constructor(reason: WalletFailure, message: string) {
    super(message);
    this.name = "WalletError";
    this.reason = reason;
  }
}

type ProviderWindow = Window & { ethereum?: EIP1193Provider };

export function detectProvider(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as ProviderWindow).ethereum;
}

export const hasWallet = (): boolean => detectProvider() !== undefined;

/** The address this device connected last, so a return visit does not prompt again. */
export function connectedAddress(): Address | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && /^0x[0-9a-fA-F]{40}$/.test(stored) ? (stored as Address) : null;
  } catch {
    // Private mode, blocked storage. Not knowing is the same as not connected.
    return null;
  }
}

function remember(address: Address | null): void {
  try {
    if (address) window.localStorage.setItem(STORAGE_KEY, address);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storing it is a convenience, never a requirement.
  }
}

export function forgetWallet(): void {
  remember(null);
}

/** EIP-1193 errors carry a numeric code; 4001 is the user saying no. */
function rejected(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 4001;
}

/**
 * Puts the wallet on Monad, adding the network if it has never seen it.
 *
 * A signature made while the wallet is on another chain carries the wrong `chainId` in its domain
 * and verifies nowhere — so this has to happen before signing, not after.
 */
async function ensureMonad(provider: EIP1193Provider): Promise<void> {
  const chainIdHex = `0x${CHAIN_ID.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex as `0x${string}` }],
    });
    return;
  } catch (error) {
    if (rejected(error)) throw new WalletError("rejected", "The network switch was declined.");
    // 4902 means the wallet does not know this chain yet, which is the normal first-time case.
    const code = (error as { code?: number }).code;
    if (code !== 4902 && code !== -32603) {
      throw new WalletError("wrong-network", "This wallet could not switch to Monad.");
    }
  }

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex as `0x${string}`,
          chainName: monadTestnet.name,
          nativeCurrency: monadTestnet.nativeCurrency,
          rpcUrls: [...monadTestnet.rpcUrls.default.http],
          blockExplorerUrls: monadTestnet.blockExplorers
            ? [monadTestnet.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
  } catch (error) {
    if (rejected(error)) throw new WalletError("rejected", "Adding the network was declined.");
    throw new WalletError("network-add-failed", "This wallet could not add the Monad network.");
  }
}

export type ConnectedWallet = {
  address: Address;
  provider: EIP1193Provider;
};

/** Prompts for accounts, puts the wallet on Monad, and returns the address it will sign with. */
export async function connectWallet(): Promise<ConnectedWallet> {
  const provider = detectProvider();
  if (!provider) {
    throw new WalletError("no-wallet", "No wallet was found in this browser.");
  }

  let accounts: readonly string[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as readonly string[];
  } catch (error) {
    if (rejected(error)) throw new WalletError("rejected", "The connection was declined.");
    throw new WalletError("unknown", "That wallet could not be connected.");
  }

  const address = accounts[0];
  if (!address) throw new WalletError("rejected", "No account was shared.");

  await ensureMonad(provider);
  remember(address as Address);

  return { address: address as Address, provider };
}

/**
 * Reconnects without a prompt, or returns undefined.
 *
 * `eth_accounts` never prompts: it reports what is already permitted. A wallet the person has since
 * disconnected reports nothing, and this device forgets it.
 */
export async function resumeWallet(): Promise<ConnectedWallet | undefined> {
  const provider = detectProvider();
  if (!provider || !connectedAddress()) return undefined;

  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as readonly string[];
    const address = accounts[0];
    if (!address) {
      forgetWallet();
      return undefined;
    }
    remember(address as Address);
    return { address: address as Address, provider };
  } catch {
    return undefined;
  }
}

/** A viem wallet client over the connected provider. Used only to sign, never to send. */
export function walletClientFor(wallet: ConnectedWallet) {
  return createWalletClient({
    account: wallet.address,
    chain: monadTestnet,
    transport: custom(wallet.provider),
  });
}
