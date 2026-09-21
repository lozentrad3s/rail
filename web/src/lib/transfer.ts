/**
 * Turning what the chat proposed into something a person can approve.
 *
 * The screen that shows this must not name the machinery — the ban list in CLAUDE.md covers every
 * file under `(sender)` and `components/sender`, and the field names alone would fail it. So the
 * orchestration lives here: the UI gets a recipient, two amounts and a deadline, and hands back a
 * decision.
 */
import { authoriseTransfer, type Terms } from "@/lib/account/authorise";
import { unlockAccount } from "@/lib/account/passkey";
import { readDraft, readQuote, submitOrder } from "@/lib/rail-api";

export type Proposal = {
  draftId: string;
  /** Minor units of the local currency — kobo for naira. */
  localAmountMinor: bigint;
  /** The most the sender can be charged, in dollars. Providers compete below it. */
  mostYouPay: number;
  /** What it is worth at today's reference rate, in dollars. */
  worthToday: number;
  /** When this proposal stops being signable. */
  expiresAt: number;
  recipient: {
    contactName: string;
    bankName: string;
    accountName: string;
    /** Shown in full here and nowhere else, so the sender can check it before Face ID. */
    accountNumber: string;
    bankCode: string;
  };
  /** Opaque to the UI. Carried back into `approveProposal` untouched. */
  terms: Terms;
};

const DECIMALS = 1_000_000;
const toDollars = (units: bigint): number => Number(units) / DECIMALS;

/** Reads the proposal and prices it. Nothing here commits the sender to anything. */
export async function loadProposal(draftId: string): Promise<Proposal> {
  const draft = await readDraft(draftId);
  const quote = await readQuote(draft.currency, draft.localAmount);

  const maximum = BigInt(quote.maxAusd);
  const fee = BigInt(quote.fee);

  return {
    draftId,
    localAmountMinor: BigInt(draft.localAmount),
    mostYouPay: toDollars(maximum + fee),
    worthToday: toDollars(BigInt(quote.indicativeAusd)),
    expiresAt: quote.expiresAt,
    recipient: {
      contactName: draft.recipient.contactName,
      bankName: draft.recipient.bankName,
      accountName: draft.recipient.accountName,
      accountNumber: draft.recipient.accountNumber,
      bankCode: draft.recipient.bankCode,
    },
    terms: {
      currencyBytes3: quote.currencyBytes3 as `0x${string}`,
      localAmount: BigInt(quote.localAmount),
      maxAusd: maximum,
      fee,
      relayer: quote.relayer as `0x${string}`,
      attestor: quote.attestor as `0x${string}`,
    },
  };
}

/**
 * Face ID, one signature, handed over.
 *
 * The session is ended in every case, including failure: approving a transfer never leaves
 * something on the device that could sign another one.
 */
export async function approveProposal(proposal: Proposal): Promise<{ reference: string }> {
  const unlocked = await unlockAccount();
  try {
    const signed = await authoriseTransfer({
      signer: unlocked.signer,
      address: unlocked.address,
      terms: proposal.terms,
      recipient: {
        bankCode: proposal.recipient.bankCode,
        accountNumber: proposal.recipient.accountNumber,
        accountName: proposal.recipient.accountName,
      },
    });

    const { orderId } = await submitOrder(signed);
    return { reference: orderId };
  } finally {
    unlocked.end();
  }
}
