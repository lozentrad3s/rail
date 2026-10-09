/** Configuration, all from the environment. Secrets never come from a file we commit. */
import { isAddress, type Address, type Hex } from "viem";

import { RelayerError } from "./errors.ts";

export type Config = {
  port: number;
  rpcUrl: string;
  railCore: Address;
  ausd: Address;
  attestor: Address;
  /** Signs and pays for submissions. Holds MON for gas and nothing else. */
  relayerKey: Hex;
  /**
   * Local-currency units per dollar, used only when the FX feed cannot be reached.
   *
   * Dated on purpose: 1,328 NGN was the rate on 2 Oct 2026. A fallback with no date is how the
   * previous value sat at 1,534 long enough to make every quote unfillable.
   */
  fallbackRate: bigint;
  /** Where the live rate comes from. */
  fxUrl: string;
  /** How far above the indicative price the sender's reserve sits. */
  reserveBufferBps: bigint;
  /** What the relayer charges for submitting, in AUSD units. May be 0. */
  feeAusd: bigint;
  /** A quote is only good for this long. */
  quoteTtlSeconds: number;
  /** Encrypts recipient bank details at rest. 32 bytes, hex. */
  recipientKey: Hex;
  /** Shared secret the bot presents on its own endpoints. */
  botApiKey: string | undefined;
  /** Where the app lives, for the links the bot hands out. */
  appBaseUrl: string;
  /** Origins the browser app may call from. Defaults to the app itself. */
  allowedOrigins: string[];
  /** Resolves account names so a sender sees who they are paying. */
  paystackSecretKey: string | undefined;
};

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new RelayerError("INTERNAL", `${key} is not set`);
  return value;
}

function optional(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function address(key: string): Address {
  const value = required(key);
  if (!isAddress(value)) throw new RelayerError("INTERNAL", `${key} is not an address`);
  return value;
}

function bigNumber(key: string, fallback: bigint): bigint {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  try {
    return BigInt(raw);
  } catch {
    throw new RelayerError("INTERNAL", `${key} is not a whole number`);
  }
}

/**
 * A directory from the environment, refusing one that cannot be right on this machine.
 *
 * Git Bash on Windows rewrites any argument that looks like a POSIX path, so setting
 * `VAULT_DIR=/data/vault` from it stores `C:/Program Files/Git/data/vault` on the host. On Linux that
 * is a relative directory inside the container, off the volume, and every recipient written there is
 * lost on the next deploy without a single error. It happened. A drive-letter path on a non-Windows
 * host is always this mistake, so it is replaced with the default and said out loud.
 */
export function dataDir(key: string, fallback: string): string {
  const value = optional(key);
  if (!value) return fallback;
  if (process.platform !== "win32" && /^[A-Za-z]:[\\/]/.test(value)) {
    // Git Bash prefixes its own install directory, so what was typed is whatever follows it.
    const typed = /^[A-Za-z]:[\\/]Program Files[\\/]Git([\\/].*)$/i.exec(value)?.[1]?.replace(/\\/g, "/");
    const used = typed ?? fallback;
    console.error(`${new Date().toISOString()} ${key}=${value} is a Windows path on ${process.platform}; using ${used}`);
    return used;
  }
  return value;
}

export function loadConfig(): Config {
  const appBaseUrl = (optional("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  const relayerKey = required("RELAYER_PRIVATE_KEY");
  const recipientKey = required("RECIPIENT_ENCRYPTION_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(recipientKey)) {
    throw new RelayerError("INTERNAL", "RECIPIENT_ENCRYPTION_KEY must be 32 bytes of hex");
  }

  return {
    port: Number(bigNumber("PORT", 8787n)),
    rpcUrl: required("RPC_URL"),
    railCore: address("RAIL_CORE"),
    ausd: address("AUSD_ADDRESS"),
    attestor: address("RAIL_ATTESTOR"),
    relayerKey: relayerKey as Hex,
    fallbackRate: bigNumber("FALLBACK_RATE", 1_328n),
    fxUrl: optional("FX_URL") ?? "https://open.er-api.com/v6/latest/USD",
    reserveBufferBps: bigNumber("RESERVE_BUFFER_BPS", 200n),
    feeAusd: bigNumber("FEE_AUSD", 130_000n),
    quoteTtlSeconds: Number(bigNumber("QUOTE_TTL_SECONDS", 120n)),
    recipientKey: recipientKey as Hex,
    botApiKey: optional("BOT_API_KEY"),
    appBaseUrl,
    // The app is always allowed to call the relayer; anything else has to be named explicitly.
    allowedOrigins:
      optional("ALLOWED_ORIGINS")
        ?.split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean) ?? [appBaseUrl],
    paystackSecretKey: optional("PAYSTACK_SECRET_KEY"),
  };
}
