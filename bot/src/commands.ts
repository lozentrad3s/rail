/**
 * What a message means.
 *
 * Structured commands only. A general-purpose assistant is banned on the WhatsApp Business
 * Platform, and an assistant that can be talked into anything is the wrong shape for a payments
 * bot regardless: anything this parser does not recognise becomes `help`, never a guess.
 */
import { parseAmount } from "./amounts.ts";

export type Command =
  | { kind: "help" }
  | { kind: "welcome" }
  | { kind: "balance" }
  | { kind: "contacts" }
  | { kind: "add"; contactName: string }
  | { kind: "send"; localAmount: bigint; contactName: string }
  | { kind: "send-unreadable-amount" }
  | { kind: "account-number" }
  | { kind: "rate" }
  | { kind: "fund" }
  | { kind: "about" }
  | { kind: "remove"; contactName: string }
  | { kind: "confirm" }
  | { kind: "decline" }
  | { kind: "alerts-on" }
  | { kind: "alerts-off" };

/** A run of 8–11 digits is an account number in every market we serve. */
const LOOKS_LIKE_ACCOUNT = /(?<!\d)\d{8,11}(?!\d)/;

const GREETINGS = new Set(["hi", "hello", "hey", "start", "/start", "menu", "good morning", "good afternoon", "good evening"]);

export function parseCommand(raw: string): Command {
  const text = raw.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();

  if (lower === "help" || lower === "/help" || lower === "?") return { kind: "help" };
  // For providers. "/start alerts" is what a t.me/RailpayBot?start=alerts link sends.
  if (/^(?:\/?alerts(?: on)?|\/start alerts|provider alerts|turn on alerts)$/.test(lower)) return { kind: "alerts-on" };
  if (/^(?:\/?alerts off|stop alerts|turn off alerts)$/.test(lower)) return { kind: "alerts-off" };
  if (GREETINGS.has(lower)) return { kind: "welcome" };
  if (lower === "balance" || lower === "bal") return { kind: "balance" };
  if (lower === "contacts" || lower === "contact" || lower === "list") return { kind: "contacts" };
  if (lower === "rate" || lower === "rates" || lower === "price") return { kind: "rate" };
  if (lower === "fund" || lower === "deposit" || lower === "top up" || lower === "topup") {
    return { kind: "fund" };
  }
  if (lower === "about" || lower === "support" || lower === "info") return { kind: "about" };

  // Only meaningful straight after a question the bot asked, which the handler tracks.
  if (lower === "yes" || lower === "y" || lower === "confirm") return { kind: "confirm" };
  if (lower === "no" || lower === "n" || lower === "cancel") return { kind: "decline" };

  const send = /^send\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (send) {
    const [, amountText = "", contactName = ""] = send;
    const localAmount = parseAmount(amountText);
    if (localAmount === undefined) return { kind: "send-unreadable-amount" };
    return { kind: "send", localAmount, contactName: contactName.trim() };
  }

  // Anchored on a word boundary, or "address" parses as adding a contact called "ress".
  const remove = /^(?:remove|forget|delete)(?:\s+(.*))?$/i.exec(text);
  if (remove) {
    const contactName = (remove[1] ?? "").trim();
    return { kind: "remove", contactName };
  }

  const add = /^add(?:\s+(.*))?$/i.exec(text);
  if (add) {
    const contactName = (add[1] ?? "").trim();
    // "add 0123456789" is someone pasting details. Handle it as a paste, not as a name.
    if (LOOKS_LIKE_ACCOUNT.test(contactName)) return { kind: "account-number" };
    return contactName ? { kind: "add", contactName } : { kind: "add", contactName: "" };
  }

  // Checked after the commands so "send 50000000 to mum" is a transfer, not a paste.
  if (LOOKS_LIKE_ACCOUNT.test(text)) return { kind: "account-number" };

  return { kind: "help" };
}
