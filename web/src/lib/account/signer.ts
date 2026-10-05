/**
 * One shape for both ways of signing.
 *
 * A passkey and a connected wallet produce byte-identical authorisations — the same EIP-712
 * `ReceiveWithAuthorization` over the AUSD domain, with the order id as the nonce. `RailCore`
 * cannot tell them apart and must not be able to, so nothing downstream of here should either.
 */
import type { Address, Hex } from "viem";

import { AccountError, loadAccount, unlockAccount } from "./passkey";
import {
  connectWallet,
  connectedAddress,
  hasWallet,
  resumeWallet,
  walletClientFor,
  WalletError,
} from "./wallet";

/**
 * "connected", not the obvious word.
 *
 * This literal is read by `components/sender`, which the ban list covers, so the name has to be one
 * a sender could see. The connect surface names the machinery; nothing downstream of it does.
 */
export type SignerKind = "passkey" | "connected";

/**
 * The linked account, under names a sender-facing screen may use.
 *
 * The ban list is checked by grep over the source, so an import path carrying the word fails it just
 * as a visible string would — and that strictness is right, because an identifier is one careless
 * autocomplete away from being rendered. These are the same functions; this file is where the
 * vocabulary changes, as it already does for `SignerKind`.
 */
export {
  connectedAddress as linkedAddress,
  connectedSnapshot as linkedSnapshot,
  serverConnectedSnapshot as serverLinkedSnapshot,
  subscribeConnected as subscribeLinked,
  forgetWallet as forgetLinked,
} from "./wallet";

/** Failure reasons in words a sender-facing screen may use. */
export type SignerFailure =
  | "cancelled"
  | "wrong-chain"
  | "chain-add-failed"
  | "none-available"
  | "unknown";

const WALLET_FAILURES: Record<string, SignerFailure> = {
  rejected: "cancelled",
  "wrong-network": "wrong-chain",
  "network-add-failed": "chain-add-failed",
  "no-wallet": "none-available",
  unknown: "unknown",
};

/**
 * Translates either signer's error into something a sender-facing screen can name.
 *
 * Returns undefined when this is not a signing failure at all, so the caller can fall through to
 * its own handling rather than mislabel an unrelated error as a declined signature.
 */
export function signerFailure(error: unknown): SignerFailure | undefined {
  if (error instanceof WalletError) return WALLET_FAILURES[error.reason] ?? "unknown";
  if (error instanceof AccountError) {
    return error.reason === "cancelled" ? "cancelled" : "unknown";
  }
  return undefined;
}

/** Exactly the one typed-data payload Rail signs. Narrow on purpose: nothing else may be signed. */
export type AuthorisationRequest = {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  message: {
    from: Address;
    to: Address;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: Hex;
  };
};

const TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type TransferSigner = {
  address: Address;
  kind: SignerKind;
  sign: (request: AuthorisationRequest) => Promise<Hex>;
  /** Ends a passkey session. A no-op for a wallet, which holds its own key and its own prompt. */
  end: () => void;
};

/** What this device can sign with right now, without prompting for anything. */
export function availableSigners(): { passkey: boolean; wallet: boolean; connected: boolean } {
  return {
    passkey: loadAccount() !== null,
    wallet: hasWallet(),
    connected: connectedAddress() !== null,
  };
}

/**
 * The address a given signer would use, without prompting for it.
 *
 * A passkey's address is stored alongside it precisely so this does not need a Face ID prompt;
 * asking somebody to authenticate just so a screen can read their balance would be absurd. Returns
 * undefined when that signer is not set up on this device.
 */
export function addressFor(kind: SignerKind): Address | undefined {
  return kind === "connected"
    ? (connectedAddress() ?? undefined)
    : (loadAccount()?.address ?? undefined);
}

/** Face ID, then a session that is ended the moment the caller is done with it. */
export async function passkeySigner(): Promise<TransferSigner> {
  const unlocked = await unlockAccount();
  return {
    address: unlocked.address,
    kind: "passkey",
    sign: ({ domain, message }) =>
      unlocked.signer.signTypedData({
        domain,
        types: TYPES,
        primaryType: "ReceiveWithAuthorization",
        message,
      }),
    end: () => unlocked.end(),
  };
}

/**
 * The wallet the sender already has.
 *
 * Resumes silently when it can, so approving a transfer is one prompt — the signature — rather than
 * two. The key never leaves the wallet, and this never asks it to send anything.
 */
export async function walletSigner(): Promise<TransferSigner> {
  const wallet = (await resumeWallet()) ?? (await connectWallet());
  const client = walletClientFor(wallet);

  return {
    address: wallet.address,
    kind: "connected",
    sign: ({ domain, message }) =>
      client.signTypedData({
        account: wallet.address,
        domain,
        types: TYPES,
        primaryType: "ReceiveWithAuthorization",
        message,
      }),
    end: () => {
      // Nothing to tear down: the wallet keeps its own key and we never held one.
    },
  };
}

export function signerFor(kind: SignerKind): Promise<TransferSigner> {
  return kind === "connected" ? walletSigner() : passkeySigner();
}

/**
 * The signer to offer first.
 *
 * A wallet already connected on this device is the fewest prompts, so it wins. Otherwise a passkey
 * account on the device. Otherwise a wallet to connect. If none of the three, the caller sends the
 * person to set one up.
 */
export function preferredSigner(): SignerKind | undefined {
  const available = availableSigners();
  if (available.connected) return "connected";
  if (available.passkey) return "passkey";
  if (available.wallet) return "connected";
  return undefined;
}
