/**
 * The bot's view of the relayer.
 *
 * Deliberately narrow: there is no method here that moves money. `POST /v1/orders` is absent on
 * purpose (invariant 2) — the bot proposes, the app signs. If a future change needs the bot to
 * submit something, that change is wrong.
 */

export type ContactSummary = {
  contactId: string;
  contactName: string;
  accountName: string;
  bankName: string;
  accountLast4: string;
};

export type Quote = {
  currency: string;
  localAmount: string;
  indicativeAusd: string;
  maxAusd: string;
  expiresAt: number;
};

export class RelayerUnavailable extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RelayerUnavailable";
    this.code = code;
  }
}

export class RelayerClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.#baseUrl = baseUrl;
    this.#apiKey = apiKey;
  }

  async #call<T>(path: string, init?: { method?: string; body?: unknown; bot?: boolean }): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    if (init?.bot !== false) headers.authorization = `Bearer ${this.#apiKey}`;

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers,
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        // A chat that never replies is worse than one that apologises.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new RelayerUnavailable("UNREACHABLE", "the relayer did not answer", { cause });
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (cause) {
      throw new RelayerUnavailable("BAD_RESPONSE", "the relayer sent something unreadable", { cause });
    }

    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } }).error;
      throw new RelayerUnavailable(error?.code ?? "INTERNAL", error?.message ?? `status ${response.status}`);
    }
    return parsed as T;
  }

  contactLink(waId: string, contactName: string): Promise<{ url: string }> {
    return this.#call("/v1/contact-links", { method: "POST", body: { waId, contactName } });
  }

  contacts(waId: string): Promise<ContactSummary[]> {
    return this.#call(`/v1/contacts?waId=${encodeURIComponent(waId)}`);
  }

  draft(input: {
    waId: string;
    contactId: string;
    currency: string;
    localAmount: bigint;
  }): Promise<{ draftId: string; url: string }> {
    return this.#call("/v1/drafts", {
      method: "POST",
      body: { ...input, localAmount: input.localAmount.toString() },
    });
  }

  quote(currency: string, localAmount: bigint): Promise<Quote> {
    return this.#call(
      `/v1/quote?currency=${encodeURIComponent(currency)}&localAmount=${localAmount.toString()}`,
      { bot: false },
    );
  }

  accountLink(waId: string): Promise<{ url: string }> {
    return this.#call("/v1/account-links", { method: "POST", body: { waId } });
  }

  /** Undefined when this number has never been connected to an account. */
  async account(waId: string): Promise<{ address: `0x${string}` } | undefined> {
    try {
      return await this.#call(`/v1/accounts?waId=${encodeURIComponent(waId)}`);
    } catch (cause) {
      if (cause instanceof RelayerUnavailable && cause.code === "NOT_FOUND") return undefined;
      throw cause;
    }
  }
}
