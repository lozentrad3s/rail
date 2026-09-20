/** Configuration, all from the environment. Secrets never come from a file we commit. */
import { isAddress, type Address } from "viem";

export class ConfigError extends Error {
  readonly key: string;

  constructor(key: string, detail: string) {
    super(`${key} ${detail}`);
    this.name = "ConfigError";
    this.key = key;
  }
}

/** How a provider bids, and the limits it will not cross. */
export type Config = {
  rpcUrl: string;
  railCore: Address;
  lpRegistry: Address;
  /** Currencies this provider can actually deliver, as ISO codes. */
  currencies: string[];
  /** Local-currency units per dollar, e.g. 1534 NGN. */
  rate: bigint;
  /** The provider's margin, in basis points, added to the reference rate. */
  spreadBps: bigint;
  /** The largest order this provider will bid on, in AUSD base units. */
  maxOrderAusd: bigint;
  /** Only bid when the sender's chosen attestor is one we accept. Empty means any. */
  attestorAllowlist: Address[];
  /**
   * How often to look for new orders. The commit window is a handful of blocks — about a second
   * and a half — so this has to stay well under a second.
   */
  pollIntervalMs: number;
  /** Where bid salts are written before the commit is sent. */
  stateDir: string;
  /** Skip waiting for a human to confirm the payout really left their bank. Testnet only. */
  autoConfirmPayout: boolean;
  /** A label for logs, so two instances bidding against each other are distinguishable. */
  label: string;
};

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new ConfigError(key, "is not set");
  return value;
}

function optional(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function address(key: string): Address {
  const value = required(key);
  if (!isAddress(value)) throw new ConfigError(key, `is not an address: ${value}`);
  return value;
}

function bigNumber(key: string, fallback: bigint): bigint {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  try {
    return BigInt(raw);
  } catch {
    throw new ConfigError(key, `is not a whole number: ${raw}`);
  }
}

export function loadConfig(env = process.env): Config {
  const spreadBps = bigNumber("SPREAD_BPS", 150n);
  return {
    rpcUrl: required("RPC_URL"),
    railCore: address("RAIL_CORE"),
    lpRegistry: address("LP_REGISTRY"),
    currencies: (optional("CURRENCIES") ?? "NGN")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
    rate: bigNumber("RATE", 1_534n),
    spreadBps,
    maxOrderAusd: bigNumber("MAX_ORDER_AUSD", 500_000_000n),
    attestorAllowlist: (optional("ATTESTOR_ALLOWLIST") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => {
        if (!isAddress(a)) throw new ConfigError("ATTESTOR_ALLOWLIST", `contains a bad address: ${a}`);
        return a;
      }),
    pollIntervalMs: Number(bigNumber("POLL_INTERVAL_MS", 250n)),
    stateDir: optional("STATE_DIR") ?? ".matcher",
    autoConfirmPayout: /^(1|true)$/i.test(optional("AUTO_CONFIRM_PAYOUT") ?? ""),
    label: optional("MATCHER_LABEL") ?? `spread ${spreadBps}bps`,
  } satisfies Config;
}
