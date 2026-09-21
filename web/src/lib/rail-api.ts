/**
 * Talking to the relayer from the app.
 *
 * Nothing here signs anything — signing happens in `lib/account`, behind Face ID. This module only
 * carries what was already signed, and reads back what the sender is about to approve.
 */

const BASE = (process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:8787").replace(/\/+$/, "");

export type ApiFailure = "expired" | "rejected" | "offline" | "unknown";

export class ApiError extends Error {
  readonly reason: ApiFailure;

  constructor(reason: ApiFailure, message: string) {
    super(message);
    this.name = "ApiError";
    this.reason = reason;
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
    const code = (parsed as { error?: { code?: string } }).error?.code;
    if (code === "NOT_FOUND") throw new ApiError("expired", "This link has expired.");
    if (code === "UNAUTHORIZED") throw new ApiError("rejected", "That didn't match.");
    throw new ApiError("unknown", "That didn't work. Nothing has been charged.");
  }
  return parsed as T;
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
