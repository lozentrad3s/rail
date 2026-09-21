/**
 * Drafts: what the chat proposes, and what the app confirms.
 *
 * This is invariant 2 made concrete. The bot builds a draft and hands back a link; it cannot sign,
 * cannot submit, and cannot move anything. The app opens the draft, shows the sender exactly who
 * is being paid, and waits for Face ID. Someone who takes over a WhatsApp account can create
 * drafts all day and move nothing.
 */
import { RelayerError } from "./errors.ts";
import { getContact, type Contact } from "./contacts.ts";
import { randomToken, type Vault } from "./vault.ts";

/** Long enough to walk from the chat to the app, short enough that a stale price is not signed. */
export const DRAFT_TTL_SECONDS = 15 * 60;

export type Draft = {
  draftId: string;
  waId: string;
  contactId: string;
  currency: string;
  localAmount: string;
  createdAt: number;
  expiresAt: number;
};

/** What the app is shown. The full account number appears here and nowhere else. */
export type DraftDetail = {
  draftId: string;
  currency: string;
  localAmount: string;
  expiresAt: number;
  recipient: {
    contactName: string;
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
};

const draftKey = (draftId: string): string => `draft_${draftId}`;

export function createDraft(
  vault: Vault,
  input: { waId: string; contactId: string; currency: string; localAmount: bigint },
  appBaseUrl: string,
): { draftId: string; url: string; expiresAt: number } {
  if (input.localAmount <= 0n) throw new RelayerError("BAD_REQUEST", "localAmount must be positive.");

  // Fails here if the contact does not belong to this sender, rather than at signing time.
  getContact(vault, input.waId, input.contactId);

  // 128 bits: the draft id is in a URL, so it must not be guessable.
  const draftId = randomToken(16);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + DRAFT_TTL_SECONDS;

  const draft: Draft = {
    draftId,
    waId: input.waId,
    contactId: input.contactId,
    currency: input.currency,
    localAmount: input.localAmount.toString(),
    createdAt: now,
    expiresAt,
  };

  vault.put(draftKey(draftId), draft, { expiresAt });
  return { draftId, url: `${appBaseUrl}/c/${draftId}`, expiresAt };
}

/**
 * Opens a draft in the app.
 *
 * Knowing the draft id is enough to read it, because the id is 128 random bits and the draft is
 * only a proposal — reading it moves nothing. Authorising it still needs the sender's passkey.
 */
export function readDraft(vault: Vault, draftId: string): DraftDetail {
  const draft = vault.get<Draft>(draftKey(draftId));
  if (!draft) throw new RelayerError("NOT_FOUND", "This request has expired. Ask for a new one.");

  const contact: Contact = getContact(vault, draft.waId, draft.contactId);

  return {
    draftId: draft.draftId,
    currency: draft.currency,
    localAmount: draft.localAmount,
    expiresAt: draft.expiresAt,
    recipient: {
      contactName: contact.contactName,
      bankCode: contact.bankCode,
      bankName: contact.bankName,
      accountNumber: contact.accountNumber,
      accountName: contact.accountName,
    },
  };
}
