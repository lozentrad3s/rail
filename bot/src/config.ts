/** Configuration, all from the environment. Secrets never come from a file we commit. */
import { isAddress, type Address } from "viem";

export type Config = {
  port: number;
  /** Meta's GET handshake token. Ours to choose, and it must match what the app is configured with. */
  verifyToken: string;
  /** Signs every webhook Meta sends. Without it nothing is trusted. */
  appSecret: string;
  /** Sends replies through the Cloud API. */
  accessToken: string;
  phoneNumberId: string;
  graphBaseUrl: string;
  /** Where the relayer lives, and the shared secret for its bot-only endpoints. */
  relayerBaseUrl: string;
  relayerApiKey: string;
  /** For reading a balance. Read-only: the bot holds no key and signs nothing. */
  rpcUrl: string;
  ausd: Address;
  /** Every transfer this pilot quotes is in naira. */
  currency: string;
};

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

export function loadConfig(): Config {
  const ausd = required("AUSD_ADDRESS");
  if (!isAddress(ausd)) throw new Error("AUSD_ADDRESS is not an address");

  return {
    port: Number(process.env.PORT ?? 8788),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    graphBaseUrl: (process.env.GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0").replace(/\/+$/, ""),
    relayerBaseUrl: (process.env.RELAYER_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, ""),
    relayerApiKey: required("BOT_API_KEY"),
    rpcUrl: required("RPC_URL"),
    ausd,
    currency: (process.env.CURRENCY ?? "NGN").toUpperCase(),
  };
}
