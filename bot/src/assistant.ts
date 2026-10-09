/**
 * The assistant: Claude, for messages the other two layers could not read.
 *
 * It is a business assistant scoped to Rail, not a general-purpose one — the line Meta draws, and
 * the right shape for a payments chat anyway (CLAUDE.md, invariant 2). Three things keep it there:
 *
 * 1. **It cannot act.** It returns a structured intent. A `send` it extracts goes through exactly
 *    the code a typed command does: a draft and a link, approved on the sender's phone. The model
 *    never sees a key, a session, or an account, and nothing it says can move money.
 * 2. **It only knows Rail.** Its whole world is the fact sheet below. Anything else is `off_topic`.
 * 3. **It never sees an account number.** Every run of 8+ digits is replaced before the text leaves
 *    this process, and a reply that uses a ban-list word is thrown away for a safe one.
 *
 * Optional: without ANTHROPIC_API_KEY the bot still understands natural language through
 * `understand.ts`; this only widens what it can follow.
 */
import Anthropic from "@anthropic-ai/sdk";

export const INTENTS = [
  "send",
  "add",
  "contacts",
  "remove",
  "balance",
  "rate",
  "fund",
  "about",
  "answer",
  "off_topic",
] as const;
export type Intent = (typeof INTENTS)[number];

export type AssistantResult = {
  intent: Intent;
  /** As the person wrote it, e.g. "20k". Parsed by `parseAmount`, never trusted as a number. */
  amount?: string;
  contact?: string;
  /** Only for `answer` and `off_topic`. */
  reply?: string;
};

export type Assistant = (text: string) => Promise<AssistantResult | undefined>;

/** Runs that long are account numbers in every market Rail serves; amounts are written shorter. */
export function redact(text: string): string {
  return text.replace(/\d[\d\s-]{6,}\d/g, (run) =>
    run.replace(/\D/g, "").length >= 8 ? "[number removed]" : run,
  );
}

/** The same list CLAUDE.md greps for: no reply that contains one of these ever reaches a sender. */
const BANNED =
  /wallet|gas|blockchain|crypto|seed phrase|mnemonic|web3|on-chain|onchain|token|stablecoin|usdt|usdc|ausd|\bMON\b|monad|metamask|tx hash|transaction hash|sign(ing)? (a )?message/i;

export const usesBannedWord = (text: string): boolean => BANNED.test(text);

/**
 * Everything the assistant knows. Frozen text, first in the request, so it is cached across calls.
 * Facts only — every number here is one the product actually does today.
 */
const SYSTEM = `You are Rail's assistant inside a Telegram chat. Rail lets people in the UK and US send money to bank accounts in Nigeria, straight from this chat.

Your job: understand what the person wants and either (a) turn it into one of Rail's actions, or (b) answer their question about Rail warmly and briefly. You are not a general-purpose assistant.

FACTS (use only these; never invent numbers, partners, licences or features):
- The sender says how much and who to. Rail replies with a link; the sender approves on their phone with Face ID or a passkey. The chat can only suggest a payment, never approve one. Someone who took over the chat could not move money.
- The sender's dollars wait in escrow until delivery is proven. Rail never holds the family's naira.
- Providers (businesses and individuals holding naira and a bank account) compete in a sealed auction: about 45 seconds to place sealed bids, about 45 to reveal. The lowest bid wins and pays the recipient from its own bank account, with a reference on the transfer.
- The winning provider must lock up 110% of its bid first. If it does not prove the payment in time, the sender gets their money back and the provider's locked deposit is paid to the sender too.
- If nobody bids, the money comes back automatically, usually within a minute.
- Cost: the winning bid plus a fixed fee of about 13 cents. The sender sees the most it can cost before approving; whatever the auction saves comes back to them. Rail takes no cut of the exchange rate.
- Speed on the pilot: usually under two minutes from approval to delivered. Do not say "instant".
- The recipient needs only a normal bank account. No app.
- Bank details are never typed in the chat: "add <name>" sends a private link to enter them, and the chat only ever shows the last four digits.
- Live today: Nigeria, from the UK and the US. Next, as providers join: Ghana, Kenya, South Africa, India, the Philippines and others.
- This is a pilot. Two automated providers bid on every transfer and their bank payouts are simulated; balances are practice money.
- Rail does not guarantee that nothing can go wrong. It replaces trusting an unknown provider with collateral, escrow and settlement anyone can check. Never say "guaranteed" or "risk-free".

ACTIONS (set intent; the app does the rest):
- send: they want to send money. Put the amount exactly as written in "amount" (e.g. "20k", "20,000", "20 thousand") and who in "contact" (e.g. "mum", without "my"). If the amount is missing, still use send with no amount.
- add: they want to add a new person they send to. Put the name in "contact".
- contacts: who they can send to. remove: forget someone ("contact"). balance: what they have. rate: today's rate. fund: how to put money in. about: what Rail is.
- answer: a question about Rail, sending money, or this chat. Write the reply in "reply".
- off_topic: anything unrelated to sending money with Rail (weather, coding, jokes, general knowledge, other companies' products). Write a short, friendly "reply" that says you can only help with sending money through Rail and lists two things you can do.

HOW TO WRITE A REPLY:
- Warm, plain English, like a helpful person. Two to five short sentences. No headings.
- Never use these words: wallet, gas, blockchain, crypto, token, stablecoin, AUSD, USDC, USDT, Monad, MON, web3, on-chain, seed phrase, metamask, transaction hash. Say "digital dollars" or "dollars" instead.
- Never ask for, repeat or discuss a bank account number. If one is mentioned, say to use "add <name>" and the private link instead.
- If you are not sure, say so and suggest something they can say, like "send 50k to mum".`;

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    amount: { type: "string" },
    contact: { type: "string" },
    reply: { type: "string" },
  },
  required: ["intent"],
  additionalProperties: false,
} as const;

/** Validates what came back. Anything malformed is "could not understand", never a guess. */
export function parseResult(raw: string): AssistantResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const intent = record.intent;
  if (typeof intent !== "string" || !(INTENTS as readonly string[]).includes(intent)) return undefined;

  const text = (key: string): string | undefined => {
    const field = record[key];
    return typeof field === "string" && field.trim() ? field.trim().slice(0, 600) : undefined;
  };
  const result: AssistantResult = { intent: intent as Intent };
  const amount = text("amount");
  const contact = text("contact");
  const reply = text("reply");
  if (amount) result.amount = amount;
  if (contact) result.contact = contact;
  if (reply) {
    // A reply that slipped into the machinery's vocabulary is dropped, not edited.
    if (usesBannedWord(reply)) return result;
    result.reply = reply;
  }
  return result;
}

export function claudeAssistant(options: { apiKey: string; log?: (line: string) => void }): Assistant {
  // A chat reply that takes longer than this is worse than the plain help text.
  const client = new Anthropic({ apiKey: options.apiKey, timeout: 20_000, maxRetries: 1 });

  return async (text) => {
    try {
      const request = {
        model: "claude-opus-5-5",
        max_tokens: 1024,
        // Refusals fall back server-side to a model that can answer, routed by category.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Chat-shaped and latency-sensitive: low effort is the right setting for this route.
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: redact(text).slice(0, 1_000) }],
      };
      const response = await client.beta.messages.create(
        request as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
      );
      if (response.stop_reason === "refusal") return undefined;
      const block = response.content.find((b) => b.type === "text");
      return block && block.type === "text" ? parseResult(block.text) : undefined;
    } catch (error) {
      const detail =
        error instanceof Anthropic.RateLimitError
          ? "rate-limited"
          : error instanceof Anthropic.APIError
            ? `api ${error.status}`
            : error instanceof Error
              ? error.message
              : String(error);
      options.log?.(`${new Date().toISOString()} assistant-failed ${detail}`);
      return undefined;
    }
  };
}
