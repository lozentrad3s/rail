// Passkey accounts — docs/INTERFACES.md §5.5.1.
//
// The rule this file exists to enforce: a signature always costs one Face ID prompt. There is no
// stored key and no ambient session, so nothing here can move money without the person present.

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { Address, LocalAccount } from "viem";
import { deriveKey, SAVINGS_INDEX, SPENDING_INDEX } from "./keys";

const STORAGE_KEY = "rail.account.v1";
const ACCOUNT_CHANGED = "rail:account-changed";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Public account data. The private key is never here, and never persisted anywhere.
 *
 * `savingsAddress` is the second account the same passkey derives (index 1). A stored record from
 * before savings existed has none, and the next unlock fills it in.
 */
export type StoredAccount = {
  version: 1 | 2;
  credentialId: string;
  transports?: readonly string[];
  address: Address;
  savingsAddress?: Address;
  rpId: string;
};

export type AccountFailureReason =
  /** The browser saved the passkey somewhere that returns no PRF (desktop Chrome local profile). */
  | "unsupported-passkey"
  /** Face ID was cancelled, timed out, or WebAuthn is unavailable. */
  | "cancelled"
  /** Not the live site: a passkey binds permanently to the host that created it. */
  | "host-not-allowed"
  | "unknown";

export class AccountError extends Error {
  constructor(
    readonly reason: AccountFailureReason,
    cause?: unknown,
  ) {
    super(reason, { cause });
    this.name = "AccountError";
  }
}

/**
 * The relying party this host may mint passkeys for.
 *
 * A passkey is bound to its `rpId` forever, so a preview or `vercel.app` host must never create one
 * (CLAUDE.md) — it would produce accounts nobody can reach from the real domain.
 */
export function resolveRpId(): { rpId: string; allowed: boolean } {
  if (typeof window === "undefined") return { rpId: "", allowed: false };
  const host = window.location.hostname;
  const configured = process.env.NEXT_PUBLIC_PASSKEY_RP_ID?.trim();

  if (DEV_HOSTS.has(host)) return { rpId: host, allowed: true };
  if (configured && (host === configured || host.endsWith(`.${configured}`))) {
    return { rpId: configured, allowed: true };
  }
  return { rpId: configured ?? host, allowed: false };
}

/**
 * The stored account as a raw string, for `useSyncExternalStore`.
 *
 * Returning the string keeps the snapshot referentially stable between renders; the caller parses
 * it. The server snapshot is always null, so the first client render matches the server HTML and
 * only then swaps in what this device knows.
 */
export function accountSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function serverAccountSnapshot(): null {
  return null;
}

/** Notifies subscribers when this tab or another tab changes the stored account. */
export function subscribeAccount(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(ACCOUNT_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ACCOUNT_CHANGED, onChange);
  };
}

export function parseAccount(raw: string | null): StoredAccount | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      ((parsed as StoredAccount).version === 1 || (parsed as StoredAccount).version === 2) &&
      typeof (parsed as StoredAccount).address === "string" &&
      typeof (parsed as StoredAccount).credentialId === "string"
    ) {
      return parsed as StoredAccount;
    }
    return null;
  } catch {
    // Private mode, blocked storage, or corrupt JSON: behave like a new device.
    return null;
  }
}

/** The account this device knows about, or null on a fresh device. */
export function loadAccount(): StoredAccount | null {
  return parseAccount(accountSnapshot());
}

function saveAccount(account: StoredAccount): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  } catch {
    // A viewer who blocks storage can still use the account this session; they unlock by passkey
    // next time, since the credential is discoverable.
  }
  window.dispatchEvent(new Event(ACCOUNT_CHANGED));
}

/** Forgets this device's pointer to the account. The passkey and the funds are untouched. */
export function forgetAccount(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to forget */
  }
  window.dispatchEvent(new Event(ACCOUNT_CHANGED));
}

function toAccountError(error: unknown): AccountError {
  if (error instanceof AccountError) return error;
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") return new AccountError("unsupported-passkey", error);
    if (error.code === "PASSKEY_OPERATION_FAILED") return new AccountError("cancelled", error);
  }
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return new AccountError("cancelled", error);
  }
  return new AccountError("unknown", error);
}

/** A live signing session plus the viem account that signs with it. Call `end()` when finished. */
export type UnlockedAccount = {
  address: Address;
  signer: LocalAccount<"mera">;
  end: () => void;
};

function unlockFrom(prfOutput: Uint8Array, index: number): UnlockedAccount {
  const privateKey = deriveKey(prfOutput, index);
  const session: Secp256k1SigningSession = createSecp256k1SigningSession({ privateKey });
  const signer = toViemAccount(session);
  return { address: signer.address, signer, end: () => session.end() };
}

/**
 * Both addresses this passkey owns, from one PRF output.
 *
 * The second account costs nothing extra — no second passkey, no second prompt — which is the whole
 * point of deriving keys from PRF rather than storing them. Sessions are ended straight away: this
 * reads addresses, it does not leave anything able to sign.
 */
function addressesFrom(prfOutput: Uint8Array): { address: Address; savingsAddress: Address } {
  const spending = unlockFrom(prfOutput, SPENDING_INDEX);
  const savings = unlockFrom(prfOutput, SAVINGS_INDEX);
  const addresses = { address: spending.address, savingsAddress: savings.address };
  spending.end();
  savings.end();
  return addresses;
}

/**
 * Creates the passkey and returns the account it derives.
 *
 * One Face ID prompt on authenticators that evaluate PRF at creation; Mera runs a second ceremony
 * on those that don't. The signing session is ended immediately — creating an account never leaves
 * a key able to sign.
 */
export async function createAccount(label: string): Promise<StoredAccount> {
  const { rpId, allowed } = resolveRpId();
  if (!allowed) throw new AccountError("host-not-allowed");

  try {
    const created = await createPasskeyWithPrfOutput({
      rp: { id: rpId, name: "Rail" },
      user: { name: label, displayName: label },
    });
    const account: StoredAccount = {
      version: 2,
      credentialId: created.credentialId,
      transports: created.transports,
      ...addressesFrom(created.prfOutput),
      rpId,
    };
    saveAccount(account);
    return account;
  } catch (error) {
    throw toAccountError(error);
  }
}

/**
 * Unlocks an existing account with Face ID.
 *
 * Without a stored credential the platform picks a discoverable passkey, which is how someone signs
 * in on a second device. The returned session must be ended by the caller.
 */
export async function unlockAccount(
  options: { index?: number; credential?: PasskeyCredentialMetadata } = {},
): Promise<UnlockedAccount & { credentialId: string }> {
  try {
    const asserted = await assertPasskey(options.credential);
    const unlocked = unlockFrom(asserted.prfOutput, options.index ?? SPENDING_INDEX);
    return { ...unlocked, credentialId: asserted.credentialId };
  } catch (error) {
    throw toAccountError(error);
  }
}

/** One Face ID prompt, returning the PRF output every account of this passkey derives from. */
async function assertPasskey(credential?: PasskeyCredentialMetadata) {
  const { rpId } = resolveRpId();
  const stored = loadAccount();
  const chosen =
    credential ??
    (stored ? { credentialId: stored.credentialId, transports: stored.transports } : undefined);
  return getPasskeyPrfOutput({ rpId, credential: chosen });
}

/**
 * Unlocks, then records the account on this device.
 *
 * Used by "I already have an account": the addresses come from the passkey itself, so a stolen or
 * tampered link can't point someone at an address they don't control. This is also what upgrades a
 * record saved before the savings account existed.
 */
export async function restoreAccount(): Promise<StoredAccount> {
  const { rpId } = resolveRpId();
  try {
    const asserted = await assertPasskey(undefined);
    const account: StoredAccount = {
      version: 2,
      credentialId: asserted.credentialId,
      ...addressesFrom(asserted.prfOutput),
      rpId,
    };
    saveAccount(account);
    return account;
  } catch (error) {
    throw toAccountError(error);
  }
}
