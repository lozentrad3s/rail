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
import { MINIMUM_MINOR } from "./amounts.ts";
import { parseCommand } from "./commands.ts";
import { RelayerUnavailable, type ContactSummary, type RelayerClient } from "./relayer.ts";

export type Deps = {
  relayer: RelayerClient;
  /** Read-only. The bot has no key and cannot spend what it reads. */
  readBalance: (address: Address) => Promise<bigint>;
  currency: string;
  log?: (line: string) => void;
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
  const command = parseCommand(text);

  try {
    switch (command.kind) {
      case "welcome":
        return messages.welcome();

      case "help":
        return messages.help();

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
