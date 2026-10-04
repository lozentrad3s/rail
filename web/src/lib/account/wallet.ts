/**
 * Connecting a wallet the sender already has.
 *
 * Discovery is EIP-6963, not `window.ethereum`, and that is the whole point of this file. With more
 * than one wallet extension installed they fight over that single global: one wins, the others are
 * shadowed, and in the worst case it resolves to a proxy that never answers a request. The symptom
 * is a button that says "check your wallet" forever while no prompt ever appears, which is exactly
 * what happened here with MetaMask and others side by side.
 *
 * EIP-6963 inverts it. Each wallet announces itself, we collect the announcements, and the person
 * picks. `window.ethereum` stays as a fallback for a wallet too old to announce.
 *
 * Still dependency-free: viem speaks EIP-1193, every wallet provides EIP-1193, and a vendor connect
 * modal is a large amount of code and trust for what is three RPC calls.
 */
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { monadTestnet } from "viem/chains";

import { CHAIN_ID } from "./chain";

const STORAGE_KEY = "rail.connected.v1";
const CHOSEN_KEY = "rail.connected.wallet.v1";

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

/** One wallet, as it described itself. */
export type DiscoveredWallet = {
  /** Reverse-DNS id, stable across sessions: `io.metamask`, `app.phantom`. */
  rdns: string;
  name: string;
  /** A data URI the wallet supplied. Rendered at a fixed size and never trusted for layout. */
  icon: string;
  provider: EIP1193Provider;
};

type AnnounceEvent = Event & {
  detail?: { info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: EIP1193Provider };
};

const announced = new Map<string, DiscoveredWallet>();
let listening = false;

/**
 * Starts collecting announcements.
 *
 * Wallets answer `eip6963:requestProvider` synchronously, but an extension that injects late can
 * announce at any time, so the listener stays on for the life of the page rather than being torn
 * down after one round.
 */
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;

  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as AnnounceEvent).detail;
    const info = detail?.info;
    if (!info?.rdns || !detail?.provider) return;
    announced.set(info.rdns, {
      rdns: info.rdns,
      name: info.name ?? info.rdns,
      icon: info.icon ?? "",
      provider: detail.provider,
    });
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

type ProviderWindow = Window & { ethereum?: EIP1193Provider };

/**
 * Every wallet that answered, plus `window.ethereum` if nothing did.
 *
 * The fallback is only used when the announcement list is empty: with even one EIP-6963 wallet
 * present, the global is the thing we are trying to avoid.
 */
export function discoverWallets(): DiscoveredWallet[] {
  if (typeof window === "undefined") return [];
  listen();

  const found = [...announced.values()];
  if (found.length > 0) return found;

  const injected = (window as ProviderWindow).ethereum;
  return injected
    ? [{ rdns: "injected", name: "Browser wallet", icon: "", provider: injected }]
    : [];
}

/** Kicks off discovery early, so the list is populated by the time somebody taps connect. */
export function startWalletDiscovery(): void {
  listen();
}

export const hasWallet = (): boolean => discoverWallets().length > 0;

export function connectedAddress(): Address | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && /^0x[0-9a-fA-F]{40}$/.test(stored) ? (stored as Address) : null;
  } catch {
    return null;
  }
}

/**
 * The connected address for `useSyncExternalStore`.
 *
 * Which wallet this device has connected is state React does not own, so a screen reads it through a
 * subscription rather than in an effect. The server snapshot is always null, so the first client
 * render matches the server HTML and only then swaps in what this device knows — without that, a
 * screen treats "not read yet" as "no account" and redirects somebody away from their own dashboard.
 */
export const connectedSnapshot = connectedAddress;

export function serverConnectedSnapshot(): null {
  return null;
}

const WALLET_CHANGED = "rail:wallet-changed";

/** Notifies subscribers when this tab or another tab connects or forgets a wallet. */
export function subscribeConnected(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(WALLET_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(WALLET_CHANGED, onChange);
  };
}

function remember(address: Address | null, rdns?: string): void {
  try {
    if (address) {
      window.localStorage.setItem(STORAGE_KEY, address);
      if (rdns) window.localStorage.setItem(CHOSEN_KEY, rdns);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(CHOSEN_KEY);
    }
  } catch {
    // Storing it is a convenience, never a requirement.
  }
  // `storage` only fires in *other* tabs, so this tab is told separately.
  window.dispatchEvent(new Event(WALLET_CHANGED));
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
 * and verifies nowhere, so this has to happen before signing rather than after.
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
    const code = (error as { code?: number }).code;
    // 4902 means the wallet has never seen this chain, which is the normal first-time case.
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
  rdns: string;
};

/**
 * Prompts the chosen wallet, puts it on Monad, and returns the address it will sign with.
 *
 * Takes the wallet explicitly when there is a choice to make. Called with nothing and exactly one
 * wallet present, it uses that one rather than making somebody pick from a list of one.
 */
export async function connectWallet(chosen?: DiscoveredWallet): Promise<ConnectedWallet> {
  const wallets = discoverWallets();
  const wallet = chosen ?? (wallets.length === 1 ? wallets[0] : undefined);

  if (!wallet) {
    throw new WalletError(
      "no-wallet",
      wallets.length === 0
        ? "No wallet was found in this browser."
        : "Choose which wallet to connect.",
    );
  }

  let accounts: readonly string[];
  try {
    // A wallet that never resolves this leaves the UI waiting forever, which is the bug EIP-6963
    // discovery exists to avoid. The timeout makes it fail honestly instead.
    accounts = (await Promise.race([
      wallet.provider.request({ method: "eth_requestAccounts" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new WalletError("unknown", "That wallet did not respond.")), 60_000),
      ),
    ])) as readonly string[];
  } catch (error) {
    if (error instanceof WalletError) throw error;
    if (rejected(error)) throw new WalletError("rejected", "The connection was declined.");
    throw new WalletError("unknown", "That wallet could not be connected.");
  }

  const address = accounts[0];
  if (!address) throw new WalletError("rejected", "No account was shared.");

  await ensureMonad(wallet.provider);
  remember(address as Address, wallet.rdns);

  return { address: address as Address, provider: wallet.provider, rdns: wallet.rdns };
}

/**
 * Reconnects without a prompt, or returns undefined.
 *
 * `eth_accounts` never prompts: it reports what is already permitted. A wallet the person has since
 * disconnected reports nothing, and this device forgets it.
 */
export async function resumeWallet(): Promise<ConnectedWallet | undefined> {
  if (typeof window === "undefined" || !connectedAddress()) return undefined;

  let chosen: string | null = null;
  try {
    chosen = window.localStorage.getItem(CHOSEN_KEY);
  } catch {
    // Unreadable storage just means we fall back to whichever wallet answers.
  }

  const wallets = discoverWallets();
  const wallet = wallets.find((w) => w.rdns === chosen) ?? wallets[0];
  if (!wallet) return undefined;

  try {
    const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as readonly string[];
    const address = accounts[0];
    if (!address) {
      forgetWallet();
      return undefined;
    }
    remember(address as Address, wallet.rdns);
    return { address: address as Address, provider: wallet.provider, rdns: wallet.rdns };
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
