/**
 * Contacts: who a sender can send to, and how their details get in.
 *
 * The chat never asks for a bank account number. Meta's policy forbids requesting financial
 * account numbers in chat, and a 10-digit NUBAN pasted into a conversation is a 10-digit NUBAN
 * sitting in Meta's servers and the sender's message history. So `add mum` returns a one-time
 * link, the details are typed into the app over HTTPS, and the chat only ever shows `····4471`.
 */
import { RelayerError } from "./errors.ts";
import { hashId, randomToken, type Vault } from "./vault.ts";

/** A link is short-lived: it is single use, but it should not sit valid in a chat for days. */
export const LINK_TTL_SECONDS = 15 * 60;

export type ContactLink = {
  waId: string;
  contactName: string;
  createdAt: number;
};

export type Contact = {
  contactId: string;
  waId: string;
  contactName: string;
  currency: string;
  bankCode: string;
  bankName: string;
  /** Held only here, never in chat and never on the chain. */
  accountNumber: string;
  accountName: string;
  createdAt: number;
};

/** What the bot and the chat are allowed to see. */
export type ContactSummary = {
  contactId: string;
  contactName: string;
  accountName: string;
  bankName: string;
  accountLast4: string;
};

export function summarise(contact: Contact): ContactSummary {
  return {
    contactId: contact.contactId,
    contactName: contact.contactName,
    accountName: contact.accountName,
    bankName: contact.bankName,
    // The last four digits are enough for a person to recognise the account, and useless to anyone else.
    accountLast4: contact.accountNumber.slice(-4),
  };
}

const linkKey = (token: string): string => `link_${token}`;
const contactKey = (waId: string, contactId: string): string => `contact_${hashId(waId)}_${contactId}`;
const contactPrefix = (waId: string): string => `contact_${hashId(waId)}_`;

/** Creates the one-time link the bot sends instead of asking for bank details. */
export function createContactLink(
  vault: Vault,
  input: { waId: string; contactName: string },
  appBaseUrl: string,
): { url: string; expiresAt: number } {
  if (!input.waId.trim()) throw new RelayerError("BAD_REQUEST", "waId is required.");
  if (!input.contactName.trim()) throw new RelayerError("BAD_REQUEST", "contactName is required.");

  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;

  vault.put(
    linkKey(token),
    { waId: input.waId, contactName: input.contactName, createdAt: Math.floor(Date.now() / 1000) },
    { expiresAt },
  );

  return { url: `${appBaseUrl}/k/${token}`, expiresAt };
}

/**
 * Turns a used link into a contact.
 *
 * The link is consumed on use: a link forwarded to someone else, or replayed later, is dead.
 */
export function saveContact(
  vault: Vault,
  input: {
    token: string;
    currency: string;
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  },
): ContactSummary {
  const link = vault.take<ContactLink>(linkKey(input.token));
  if (!link) throw new RelayerError("NOT_FOUND", "This link has expired or has already been used.");

  const contact: Contact = {
    contactId: randomToken(8),
    waId: link.waId,
    contactName: link.contactName,
    currency: input.currency,
    bankCode: input.bankCode,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
    createdAt: Math.floor(Date.now() / 1000),
  };

  vault.put(contactKey(contact.waId, contact.contactId), contact);
  return summarise(contact);
}

/** Everything this sender can send to — summaries only, never full account numbers. */
export function listContacts(vault: Vault, waId: string): ContactSummary[] {
  return vault
    .list<Contact>(contactPrefix(waId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(summarise);
}

/** The full record, for building a draft. Never returned to the bot. */
export function getContact(vault: Vault, waId: string, contactId: string): Contact {
  const contact = vault.get<Contact>(contactKey(waId, contactId));
  if (!contact) throw new RelayerError("NOT_FOUND", "No such contact.");
  return contact;
}

/**
 * Forgets a recipient.
 *
 * Scoped to the chat that owns it. The key is derived from the chat id, so a request naming
 * somebody else's contactId simply finds nothing: there is no way to delete across chats even with
 * the bot's shared secret, which is the point, because that secret is not much of a secret.
 */
export function forgetContact(vault: Vault, waId: string, contactId: string): { forgotten: boolean } {
  const existing = vault.get<Contact>(contactKey(waId, contactId));
  if (!existing) throw new RelayerError("NOT_FOUND", "No such contact.");
  vault.delete(contactKey(waId, contactId));
  return { forgotten: true };
}
