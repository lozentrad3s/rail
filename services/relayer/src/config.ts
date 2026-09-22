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
  /** Local-currency units per dollar, used until there are settled orders to price from. */
  fallbackRate: bigint;
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
    fallbackRate: bigNumber("FALLBACK_RATE", 1_534n),
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
