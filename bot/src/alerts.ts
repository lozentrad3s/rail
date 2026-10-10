/**
 * Provider alerts: the bot tells a chat when a new transfer is waiting for a provider.
 *
 * A request is only biddable for about 45 seconds, and nobody watches a web page all day. So a
 * provider says "alerts" once and the request comes to them, in the chat they already have open.
 *
 * Everything sent is public: every request is on-chain the moment it exists. So subscribing proves
 * nothing and needs nothing, and an alert can carry no bank detail because none is public. The bot
 * still cannot bid, sign or pay — it says a request exists and links to the page where the provider's
 * own wallet does the rest (invariant 2).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as messages from "./messages/index.ts";

/** Chats that asked for alerts, kept on disk so a redeploy does not silently unsubscribe them. */
export class AlertSubscribers {
  readonly #file: string;
  readonly #chats: Set<string>;

  constructor(file: string) {
    this.#file = file;
    let saved: unknown = [];
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // First run, or unreadable: start empty.
    }
    this.#chats = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
  }

  get all(): string[] {
    return [...this.#chats];
  }

  subscribe(chatId: string): void {
    this.#chats.add(chatId);
    this.#save();
  }

  unsubscribe(chatId: string): void {
    this.#chats.delete(chatId);
    this.#save();
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      writeFileSync(this.#file, JSON.stringify(this.all), { flush: true });
    } catch {
      // In memory still works; it is only a redeploy that would forget.
    }
  }
}

export type OpenRequest = {
  id: string;
  localAmount: bigint;
  maxAusd: bigint;
  commitEnd: bigint;
};

/**
 * Which requests are new since the last look. The first look only learns what exists, so a bot
 * that restarts never floods its subscribers with a backlog.
 */
export class NewRequests {
  #seen: Set<string> | undefined;

  take(open: OpenRequest[]): OpenRequest[] {
    if (!this.#seen) {
      this.#seen = new Set(open.map((request) => request.id));
      return [];
    }
    const fresh = open.filter((request) => !this.#seen!.has(request.id));
    for (const request of fresh) this.#seen.add(request.id);
    return fresh;
  }
}

/** Open requests still in their bidding window, from the indexer. */
export async function readOpen(indexerUrl: string, head: bigint): Promise<OpenRequest[]> {
  const response = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query Open($head: numeric!) {
        Order(where: { status: { _eq: "Open" }, commitEnd: { _gte: $head } }, order_by: { createdAt: desc }, limit: 20) {
          id localAmount maxAusd commitEnd
        }
      }`,
      variables: { head: head.toString() },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as {
    data?: { Order?: { id: string; localAmount: string; maxAusd: string; commitEnd: string }[] };
  };
  if (!body.data?.Order) throw new Error("indexer unavailable");
  return body.data.Order.map((order) => ({
    id: order.id,
    localAmount: BigInt(order.localAmount),
    maxAusd: BigInt(order.maxAusd),
    commitEnd: BigInt(order.commitEnd),
  }));
}

/** Measured over 1000 blocks on 4 Oct 2026; matches web/src/lib/site.ts. */
const BLOCK_MS = 302;

export function watchRequests(options: {
  subscribers: AlertSubscribers;
  indexerUrl: string;
  providerUrl: string;
  head: () => Promise<bigint>;
  send: (chatId: string, text: string) => Promise<void>;
  log: (line: string) => void;
  intervalMs?: number;
  running: () => boolean;
}): void {
  const fresh = new NewRequests();

  const tick = async () => {
    if (options.subscribers.all.length === 0) return;
    const head = await options.head();
    const open = await readOpen(options.indexerUrl, head);
    for (const request of fresh.take(open)) {
      const secondsLeft = Math.max(0, Math.round((Number(request.commitEnd - head) * BLOCK_MS) / 1000));
      const text = messages.providerAlert({
        localAmount: request.localAmount,
        ceilingUnits: request.maxAusd,
        secondsLeft,
        url: options.providerUrl,
      });
      for (const chatId of options.subscribers.all) {
        await options.send(chatId, text).catch((error: unknown) =>
          options.log(`${new Date().toISOString()} alert-failed chat=${chatId} ${String(error)}`),
        );
      }
      options.log(`${new Date().toISOString()} alerted order=${request.id} chats=${options.subscribers.all.length}`);
    }
  };

  const loop = async () => {
    while (options.running()) {
      await tick().catch((error: unknown) => options.log(`${new Date().toISOString()} alert-poll-failed ${String(error)}`));
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 3_000));
    }
  };
  void loop();
}
