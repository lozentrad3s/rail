/**
 * What the bot says back.
 *
 * Kept pure and free of the network so the whole conversation can be tested without Meta, a
 * relayer, or a chain. Every path ends in a string from `./messages` — an unhandled failure that
 * reaches a sender as a stack trace is a bug in the same class as losing their money.
 *
 * Nothing here signs, submits, or holds anything. The most this code can do is propose.
 */
import type { Address } from "viem";

import * as messages from "./messages/index.ts";
import { MINIMUM_MINOR, parseAmount } from "./amounts.ts";
import type { Assistant } from "./assistant.ts";
import { parseCommand } from "./commands.ts";
import { understand, type Understood } from "./understand.ts";
import { RelayerUnavailable, type ContactSummary, type RelayerClient } from "./relayer.ts";

export type Deps = {
  relayer: RelayerClient;
  /** Read-only. The bot has no key and cannot spend what it reads. */
  readBalance: (address: Address) => Promise<bigint>;
  currency: string;
  /** Where the app lives, for the links the bot hands out in `fund` and `about`. */
  appBaseUrl?: string;
  log?: (line: string) => void;
  /** Optional: Claude, for what neither the commands nor `understand` could read. */
  assistant?: Assistant | undefined;
};

/** What a message comes to, after all three layers have had a look. */
type Plan = Understood | { kind: "say"; text: string };

/**
 * Commands first, then natural language, then the assistant — cheapest and most predictable first.
 *
 * Whatever the assistant extracts becomes the same `Command` a typed one would, so it reaches the
 * same code: a `send` from the model still only produces a draft and a link for Face ID.
 */
async function plan(deps: Deps, text: string): Promise<Plan> {
  const command = parseCommand(text);
  if (command.kind !== "help" || /^\s*\/?(?:help|\?)\s*$/i.test(text)) return command;

  const understood = understand(text);
  if (understood) return understood;

  if (!deps.assistant) return command;
  const result = await deps.assistant(text);
  if (!result) return command;

  switch (result.intent) {
    case "send": {
      if (!result.contact) return command;
      const amount = result.amount ? parseAmount(result.amount) : undefined;
      return amount === undefined
        ? { kind: "send-needs-amount", contactName: result.contact }
        : { kind: "send", localAmount: amount, contactName: result.contact };
    }
    case "add":
      return { kind: "add", contactName: result.contact ?? "" };
    case "remove":
      return { kind: "remove", contactName: result.contact ?? "" };
    case "contacts":
    case "balance":
    case "rate":
    case "fund":
    case "about":
      return { kind: result.intent };
    case "answer":
      return result.reply ? { kind: "say", text: result.reply } : command;
    case "off_topic":
      // Our words, not the model's: the one reply that must never drift.
      return { kind: "say", text: messages.offTopic() };
  }
}

/**
 * The one question the bot is allowed to be waiting on.
 *
 * Only `remove` destroys anything, so it is the only command that asks before acting. The pending
 * question lives in memory and is dropped on restart, which is the safe direction: a forgotten
 * question means a stray "yes" does nothing, where a remembered one could delete a recipient the
 * person has since stopped thinking about.
 */
type Pending = { contactId: string; contactName: string; askedAt: number };
const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, Pending>();

const takePending = (chatId: string): Pending | undefined => {
  const question = pending.get(chatId);
  pending.delete(chatId);
  if (!question) return undefined;
  return Date.now() - question.askedAt < PENDING_TTL_MS ? question : undefined;
};

/** People type "mum", "Mum", "mummy". Exact match wins, then a unique prefix. */
function findContact(contacts: ContactSummary[], name: string): ContactSummary | undefined {
  const wanted = name.trim().toLowerCase();
  const exact = contacts.filter((c) => c.contactName.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];

  const prefixed = contacts.filter((c) => c.contactName.toLowerCase().startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export async function replyTo(deps: Deps, waId: string, text: string): Promise<string> {
  const command = await plan(deps, text);

  try {
    switch (command.kind) {
      case "say":
        return command.text;

      case "answer":
        return messages.answers[command.topic]();

      case "send-needs-amount":
        return messages.sendNeedsAmount(command.contactName);

      case "welcome":
        return messages.welcome();

      case "help":
        return messages.help();

      case "about":
        return messages.about(deps.appBaseUrl ?? "https://rail-pay.vercel.app");

      case "fund":
        return messages.howToFund(`${deps.appBaseUrl ?? "https://rail-pay.vercel.app"}/account`);

      case "rate": {
        // One dollar's worth, taken from the same quote a real transfer is priced from.
        const quote = await deps.relayer.quote(deps.currency, 100_000n);
        const perDollar =
          BigInt(quote.indicativeAusd) > 0n
            ? (100_000n * 1_000_000n) / (100n * BigInt(quote.indicativeAusd))
            : 0n;
        return messages.rateToday({
          localPerDollar: perDollar,
          currency: deps.currency,
          live: quote.rateSource !== "fallback",
        });
      }

      case "remove": {
        if (!command.contactName) return messages.addNeedsName();
        const contacts = await deps.relayer.contacts(waId);
        const contact = findContact(contacts, command.contactName);
        if (!contact) {
          return contacts.length
            ? messages.unknownContact(command.contactName)
            : messages.noContacts();
        }
        pending.set(waId, {
          contactId: contact.contactId,
          contactName: contact.contactName,
          askedAt: Date.now(),
        });
        return messages.confirmRemove(contact.contactName);
      }

      case "confirm": {
        const question = takePending(waId);
        if (!question) return messages.nothingToConfirm();
        await deps.relayer.forgetContact(waId, question.contactId);
        return messages.removed(question.contactName);
      }

      case "decline": {
        const question = takePending(waId);
        return question ? messages.keptContact(question.contactName) : messages.nothingToConfirm();
      }

      case "account-number":
        // The digits are not stored, not echoed, and not looked up. They stop here.
        return messages.accountNumberInChat();

      case "send-unreadable-amount":
        return messages.unreadableAmount();

      case "add": {
        if (!command.contactName) return messages.addNeedsName();
        const { url } = await deps.relayer.contactLink(waId, command.contactName);
        return messages.addContact(command.contactName, url);
      }

      case "contacts": {
        const contacts = await deps.relayer.contacts(waId);
        return contacts.length ? messages.contactList(contacts) : messages.noContacts();
      }

      case "balance": {
        const account = await deps.relayer.account(waId);
        if (!account) {
          const { url } = await deps.relayer.accountLink(waId);
          return messages.linkAccount(url);
        }
        return messages.balance(await deps.readBalance(account.address));
      }

      case "send": {
        if (command.localAmount < MINIMUM_MINOR) return messages.amountTooSmall();

        const contacts = await deps.relayer.contacts(waId);
        const contact = findContact(contacts, command.contactName);
        if (!contact) {
          return contacts.length
            ? messages.unknownContact(command.contactName)
            : messages.noContacts();
        }

        // The draft is built first: if the contact is not really this sender's, it fails here,
        // before a price is ever shown.
        const [draft, quote] = await Promise.all([
          deps.relayer.draft({
            waId,
            contactId: contact.contactId,
            currency: deps.currency,
            localAmount: command.localAmount,
          }),
          deps.relayer.quote(deps.currency, command.localAmount),
        ]);

        return messages.confirmSend({
          localAmount: command.localAmount,
          contact,
          indicativeUnits: BigInt(quote.indicativeAusd),
          url: draft.url,
        });
      }
    }
  } catch (cause) {
    // The reason is logged, never sent: an error message from a payments API tells an attacker
    // more than it tells the sender.
    const detail = cause instanceof RelayerUnavailable ? `${cause.code} ${cause.message}` : String(cause);
    deps.log?.(`${new Date().toISOString()} reply-failed command=${command.kind} detail=${detail}`);
    return messages.somethingWentWrong();
  }
}
