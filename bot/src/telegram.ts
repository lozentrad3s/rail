/**
 * Telegram transport.
 *
 * Telegram will either call a webhook or let the bot ask for updates itself. Asking — long polling
 * `getUpdates` — is what makes the pilot demonstrable today: no public HTTPS URL, no business
 * verification, no waiting on an approval queue. The bot reaches out, so it runs anywhere.
 *
 * The token is the only credential, and it is the whole credential: anyone holding it is the bot.
 * It comes from the environment, is never logged, and never appears in an error message — Telegram
 * puts it in the URL path, so a naive error that echoes a failed URL would leak it.
 */
import { fit } from "./server.ts";
import { replyTo, type Deps } from "./handle.ts";

/** Telegram's own cap on a text message. Longer and the send is rejected outright. */
export const TELEGRAM_MAX_BODY = 4096;

/** How long Telegram holds a poll open with no updates. Long is good: fewer requests, less lag. */
const POLL_SECONDS = 25;

/** A chatId is namespaced so a Telegram id can never collide with a phone number. */
export const chatIdFor = (telegramChatId: number | string): string => `tg:${telegramChatId}`;

export type TelegramUpdate = {
  updateId: number;
  chatId: string;
  text: string;
  /** Telegram's own id, needed to address a reply back. */
  telegramChatId: number;
};

type RawUpdate = {
  update_id?: number;
  message?: {
    chat?: { id?: number };
    text?: string;
    from?: { is_bot?: boolean };
  };
};

/**
 * Only text messages from humans.
 *
 * Telegram delivers edits, joins, photos, and messages from other bots through the same channel.
 * None of them are commands, and a bot that answers another bot is a loop.
 */
export function readUpdates(payload: unknown): TelegramUpdate[] {
  // Two shapes arrive here. `getUpdates` answers `{ ok, result: [...] }`; a webhook POSTs one bare
  // Update. Accepting both keeps a single parser — and a single set of tests — across the modes.
  const envelope = payload as { result?: RawUpdate[] } | RawUpdate | undefined;
  const updates = Array.isArray((envelope as { result?: RawUpdate[] })?.result)
    ? ((envelope as { result: RawUpdate[] }).result)
    : envelope && typeof envelope === "object"
      ? [envelope as RawUpdate]
      : [];

  const found: TelegramUpdate[] = [];

  for (const update of updates) {
    const updateId = update?.update_id;
    const telegramChatId = update?.message?.chat?.id;
    const text = update?.message?.text;

    if (typeof updateId !== "number") continue;
    if (typeof telegramChatId !== "number" || typeof text !== "string" || text.length === 0) continue;
    if (update.message?.from?.is_bot === true) continue;

    found.push({ updateId, chatId: chatIdFor(telegramChatId), text, telegramChatId });
  }

  return found;
}

export type TelegramConfig = {
  token: string;
  apiBaseUrl: string;
};

export class TelegramClient {
  readonly #base: string;

  constructor(config: TelegramConfig) {
    this.#base = `${config.apiBaseUrl.replace(/\/+$/, "")}/bot${config.token}`;
  }

  /**
   * Calls a Telegram method.
   *
   * Errors name the method, never the URL: the URL contains the bot token, and a stack trace in a
   * log aggregator is a published credential.
   */
  async #call(method: string, body?: unknown, timeoutMs = 15_000): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.#base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new Error(`telegram ${method} did not answer`, { cause: asSafeCause(cause) });
    }

    const parsed = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; description?: string }
      | undefined;

    if (!response.ok || parsed?.ok !== true) {
      throw new Error(`telegram ${method} failed: ${response.status} ${parsed?.description ?? ""}`.trim());
    }
    return parsed;
  }

  /** Confirms the token works and returns the bot's handle, so startup fails loudly not silently. */
  async whoAmI(): Promise<{ username: string }> {
    const body = (await this.#call("getMe")) as { result?: { username?: string } };
    return { username: body.result?.username ?? "unknown" };
  }

  async sendText(telegramChatId: number, text: string): Promise<void> {
    await this.#call("sendMessage", {
      chat_id: telegramChatId,
      text: fit(text, TELEGRAM_MAX_BODY),
      // Telegram's Markdown is strict and a stray underscore in a bank name breaks the whole
      // message. Plain text always arrives; bold is not worth a failed delivery.
      parse_mode: undefined,
      link_preview_options: { is_disabled: false },
    });
  }

  /**
   * Waits for updates after `offset`.
   *
   * The timeout is longer than the request timeout by design, so the HTTP deadline is what gives up
   * rather than the server closing on us mid-read.
   */
  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    const payload = await this.#call(
      "getUpdates",
      { offset, timeout: POLL_SECONDS, allowed_updates: ["message"] },
      (POLL_SECONDS + 10) * 1000,
    );
    return readUpdates(payload);
  }

  /** Clears any webhook, so long polling is not rejected for conflicting with one. */
  async dropWebhook(): Promise<void> {
    await this.#call("deleteWebhook", { drop_pending_updates: false });
  }
}

/** Never let a cause object carrying a URL — and therefore the token — reach a log. */
function asSafeCause(cause: unknown): Error {
  return new Error(cause instanceof Error ? cause.name : "request failed");
}

export type PollOptions = {
  deps: Deps;
  client: TelegramClient;
  log: (line: string) => void;
  /** Set false to stop the loop. Checked between polls. */
  running: () => boolean;
};

/**
 * The long-polling loop.
 *
 * `offset` is the acknowledgement: asking for `lastSeen + 1` tells Telegram to forget everything
 * before it, which is what stops a message being answered twice. It is only advanced *after* the
 * reply is sent, so a crash mid-reply retries rather than silently dropping someone's request.
 */
export async function pollForever(options: PollOptions): Promise<void> {
  const { deps, client, log, running } = options;
  let offset = 0;
  let backoffMs = 1_000;

  while (running()) {
    let updates: TelegramUpdate[];
    try {
      updates = await client.getUpdates(offset);
      backoffMs = 1_000;
    } catch (cause) {
      // A poll that fails is normal — a dropped connection, a Telegram hiccup. Back off so a
      // sustained outage does not turn into a tight loop against their API.
      log(`${new Date().toISOString()} poll-failed detail=${String(cause)} retry_in_ms=${backoffMs}`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    for (const update of updates) {
      try {
        const reply = await replyTo(deps, update.chatId, update.text);
        await client.sendText(update.telegramChatId, reply);
      } catch (cause) {
        // The message text is never logged: it is somebody's conversation.
        log(`${new Date().toISOString()} reply-failed update=${update.updateId} detail=${String(cause)}`);
      }
      // Acknowledged only now, so an unanswered message comes back on the next poll.
      offset = Math.max(offset, update.updateId + 1);
    }
  }
}
