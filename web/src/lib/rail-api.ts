/**
 * Talking to the relayer from the app.
 *
 * Nothing here signs anything — signing happens in `lib/account`, behind Face ID. This module only
 * carries what was already signed, and reads back what the sender is about to approve.
 */

const BASE = (process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:8787").replace(/\/+$/, "");

export type ApiFailure =
  | "expired"
  | "rejected"
  | "offline"
  | "account-not-found"
  | "not-configured"
  | "short"
  | "unknown";

export class ApiError extends Error {
  readonly reason: ApiFailure;
  /**
   * How much was needed and how much there was, in dollars. Only on "short".
   *
   * Carried because a sender can act on "you need $17.65 more" and cannot act on anything else we
   * could say here. Dollars rather than units, since nothing above this line should have to know
   * what a unit is.
   */
  readonly funds?: { required: number; available: number };

  constructor(
    reason: ApiFailure,
    message: string,
    funds?: { required: number; available: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.reason = reason;
    this.funds = funds;
  }
}

const DECIMALS = 1_000_000;

/** A decimal string of AUSD units to dollars. Returns 0 for anything unparseable. */
function toDollars(units: unknown): number {
  try {
    return Number(BigInt(String(units))) / DECIMALS;
  } catch {
    return 0;
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? {} : { "content-type": "application/json" },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError("offline", "We couldn't reach Rail. Check your connection and try again.");
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const error = (
      parsed as {
        error?: { code?: string; message?: string; data?: Record<string, string> };
      }
    ).error;
    const code = error?.code;
    if (code === "NOT_FOUND") throw new ApiError("expired", "This link has expired.");
    if (code === "UNAUTHORIZED") throw new ApiError("rejected", "That didn't match.");
    if (code === "INSUFFICIENT_BALANCE") {
      // Possible even after the app checked, if money left the account in between. Rare, and the
      // sender still deserves the number rather than a shrug.
      throw new ApiError("short", "There isn't enough in your account for this transfer.", {
        required: toDollars(error?.data?.required),
        available: toDollars(error?.data?.available),
      });
    }
    if (code === "ACCOUNT_NOT_RESOLVED") {
      // The relayer says this either when the bank cannot find the account, or when name checking
      // is not configured at all. They read very differently to a person, so they are separated.
      const configured = !/not configured/i.test(error?.message ?? "");
      throw new ApiError(
        configured ? "account-not-found" : "not-configured",
        error?.message ?? "That account could not be found.",
      );
    }
    throw new ApiError("unknown", "That didn't work. Nothing has been charged.");
  }
  return parsed as T;
}

export type Bank = { code: string; name: string };

export type SavedContact = {
  contactId: string;
  contactName: string;
  accountName: string;
  bankName: string;
  accountLast4: string;
};

/** The banks a sender can choose from. Cached by the relayer; a list changes rarely. */
export function listBanks(currency: string): Promise<Bank[]> {
  return call(`/v1/banks?currency=${encodeURIComponent(currency)}`);
}

/**
 * Who the bank says owns this account.
 *
 * This is the single most valuable check in the flow: it is what lets a sender see the real name
 * before they commit, so a typo in an account number becomes an obviously wrong name rather than
 * money sent to a stranger.
 */
export function resolveAccountName(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<{ accountName: string }> {
  const query = new URLSearchParams({
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
  });
  return call(`/v1/accounts/resolve?${query.toString()}`);
}

/** Turns the one-time link into a saved recipient. The link is consumed here. */
export function saveContact(input: {
  code: string;
  currency: string;
  bankCode: string;
  accountNumber: string;
}): Promise<SavedContact> {
  return call("/v1/contacts", {
    method: "POST",
    body: {
      token: input.code,
      currency: input.currency,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    },
  });
}

export type DraftDetail = {
  draftId: string;
  currency: string;
  localAmount: string;
  expiresAt: number;
  recipient: {
    contactName: string;
    bankCode: string;
    bankName: string;
    /** The one place a sender sees this in full, so they can check it before Face ID. */
    accountNumber: string;
    accountName: string;
  };
};

export type QuoteDetail = {
  currency: string;
  localAmount: string;
  indicativeAusd: string;
  maxAusd: string;
  fee: string;
  currencyBytes3: string;
  relayer: string;
  attestor: string;
  expiresAt: number;
};

/** What the chat proposed. Opening it changes nothing; only the signature does. */
export function readDraft(draftId: string): Promise<DraftDetail> {
  return call(`/v1/drafts/${encodeURIComponent(draftId)}`);
}

export function readQuote(currency: string, localAmount: string): Promise<QuoteDetail> {
  return call(
    `/v1/quote?currency=${encodeURIComponent(currency)}&localAmount=${encodeURIComponent(localAmount)}`,
  );
}

/**
 * What an account holds, in dollars.
 *
 * Asked through the relayer rather than an RPC of our own: the public endpoint rate-limits a browser
 * and caps what it will answer, and a balance that silently reads zero would tell somebody their
 * money is gone. The relayer has a dedicated endpoint and one job here, which is to answer this.
 */
export async function readAvailable(address: string): Promise<number> {
  const { balance } = await call<{ balance: string }>(
    `/v1/balance?address=${encodeURIComponent(address)}`,
  );
  return toDollars(balance);
}

/** Hands over what the passkey already signed. The relayer pays the fee and can alter nothing. */
export function submitOrder(body: unknown): Promise<{ orderId: string; status: string }> {
  return call("/v1/orders", { method: "POST", body });
}

/** What the app signs to prove this account is the one behind the chat. */
export function linkMessage(token: string, address: string): string {
  return `Rail link\ntoken: ${token}\naddress: ${address}`;
}

/**
 * Takes `code`, sends `token`.
 *
 * The wire field is `token` (`docs/INTERFACES.md` §5.1), but that word is on the ban list, so it
 * stops here: sender-facing code says `code` and this module does the translation.
 */
export function linkAccount(input: {
  code: string;
  address: string;
  signature: string;
}): Promise<{ waId: string; address: string }> {
  return call("/v1/accounts/link", {
    method: "POST",
    body: { token: input.code, address: input.address, signature: input.signature },
  });
}
