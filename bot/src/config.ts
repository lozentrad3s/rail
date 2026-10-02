/** Configuration, all from the environment. Secrets never come from a file we commit. */
import { isAddress, type Address } from "viem";

/**
 * Which chat this process speaks into.
 *
 * Telegram is the pilot: it needs no business verification and, when long polling, no public URL.
 * WhatsApp is the same bot behind a webhook, waiting on Meta.
 */
export type Transport = "telegram" | "whatsapp";

export type Shared = {
  transport: Transport;
  port: number;
  /** Where the relayer lives, and the shared secret for its bot-only endpoints. */
  relayerBaseUrl: string;
  relayerApiKey: string;
  /** For reading a balance. Read-only: the bot holds no key and signs nothing. */
  rpcUrl: string;
  ausd: Address;
  /** Every transfer this pilot quotes is in naira. */
  currency: string;
};

export type TelegramSettings = {
  transport: "telegram";
  /** The whole credential. Anyone holding it is the bot. */
  botToken: string;
  apiBaseUrl: string;
  /** Long polling needs no public URL, which is the entire reason Telegram is first. */
  mode: "polling" | "webhook";
  /** Only for webhook mode: Telegram echoes this back in a header we check. */
  webhookSecret: string | undefined;
};

export type WhatsAppSettings = {
  transport: "whatsapp";
  /** Meta's GET handshake token. Ours to choose, and it must match what the app is configured with. */
  verifyToken: string;
  /** Signs every webhook Meta sends. Without it nothing is trusted. */
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphBaseUrl: string;
};

export type Config = Shared & (TelegramSettings | WhatsAppSettings);

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const optional = (key: string): string | undefined => process.env[key]?.trim() || undefined;

export function loadConfig(): Config {
  const ausd = required("AUSD_ADDRESS");
  if (!isAddress(ausd)) throw new Error("AUSD_ADDRESS is not an address");

  const transport = (optional("BOT_TRANSPORT") ?? "telegram").toLowerCase();
  if (transport !== "telegram" && transport !== "whatsapp") {
    throw new Error(`BOT_TRANSPORT must be "telegram" or "whatsapp", not "${transport}"`);
  }

  const shared: Shared = {
    transport,
    port: Number(process.env.PORT ?? 8788),
    relayerBaseUrl: (optional("RELAYER_BASE_URL") ?? "http://localhost:8787").replace(/\/+$/, ""),
    relayerApiKey: required("BOT_API_KEY"),
    rpcUrl: required("RPC_URL"),
    ausd,
    currency: (optional("CURRENCY") ?? "NGN").toUpperCase(),
  };

  if (transport === "telegram") {
    const mode = (optional("TELEGRAM_MODE") ?? "polling").toLowerCase();
    if (mode !== "polling" && mode !== "webhook") {
      throw new Error(`TELEGRAM_MODE must be "polling" or "webhook", not "${mode}"`);
    }
    // A public webhook with no shared secret accepts updates from anyone claiming to be Telegram.
    if (mode === "webhook" && !optional("TELEGRAM_WEBHOOK_SECRET")) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_MODE=webhook");
    }

    return {
      ...shared,
      transport: "telegram",
      botToken: required("TELEGRAM_BOT_TOKEN"),
      apiBaseUrl: optional("TELEGRAM_API_BASE_URL") ?? "https://api.telegram.org",
      mode,
      webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),
    };
  }

  return {
    ...shared,
    transport: "whatsapp",
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    graphBaseUrl: (optional("GRAPH_BASE_URL") ?? "https://graph.facebook.com/v21.0").replace(/\/+$/, ""),
  };
}
