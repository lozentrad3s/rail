/**
 * The webhook itself.
 *
 * Separate from `index.ts` so the whole front door can be driven in tests: a webhook handler that
 * can only be exercised by a live Meta app is a webhook handler nobody has attacked.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

import { replyTo, type Deps } from "./handle.ts";
import { verifyChallenge, verifySignature } from "./signature.ts";
import { readMessages } from "./whatsapp.ts";

/** WhatsApp rejects a text body over 4096 characters, so a long reply must be cut, not sent. */
export const MAX_BODY = 4096;

/** How many delivery ids are remembered for retry suppression. */
const SEEN_LIMIT = 10_000;

/** Meta's own limit is 3MB, but a delivery we care about is a few kilobytes. */
const MAX_REQUEST_BYTES = 1_000_000;

export type Sender = { sendText: (to: string, body: string) => Promise<void> };

export type ServerOptions = {
  deps: Deps;
  whatsapp: Sender;
  verifyToken: string;
  appSecret: string;
  log: (line: string) => void;
};

export type BotServer = {
  server: Server;
  /** Resolves once every delivery accepted so far has been answered. Used by tests. */
  whenIdle: () => Promise<void>;
};

/** The signature is over the exact bytes received, so the body is never parsed before the check. */
function rawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** Cut to what WhatsApp will accept. A rejected message is worse than a shortened one. */
export function fit(body: string): string {
  return body.length <= MAX_BODY ? body : `${body.slice(0, MAX_BODY - 1)}…`;
}

export function createBotServer(options: ServerOptions): BotServer {
  const { deps, whatsapp, verifyToken, appSecret, log } = options;

  /**
   * Meta retries a webhook it does not see acknowledged within seconds, and a retry would reply
   * twice. Ids are remembered in arrival order and the oldest are dropped first — clearing the
   * whole set would let a retry of a recent delivery straight back through.
   */
  const seen = new Set<string>();
  const inFlight = new Set<Promise<void>>();

  const remember = (messageId: string): boolean => {
    if (seen.has(messageId)) return false;
    seen.add(messageId);
    if (seen.size > SEEN_LIMIT) {
      for (const oldest of seen) {
        seen.delete(oldest);
        if (seen.size <= SEEN_LIMIT) break;
      }
    }
    return true;
  };

  async function handleDelivery(payload: unknown): Promise<void> {
    for (const message of readMessages(payload)) {
      if (!remember(message.messageId)) continue;

      try {
        const reply = await replyTo(deps, message.waId, message.text);
        await whatsapp.sendText(message.waId, fit(reply));
      } catch (cause) {
        // The message text is never logged: it is somebody's conversation.
        log(`${new Date().toISOString()} delivery-failed id=${message.messageId} detail=${String(cause)}`);
      }
    }
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://bot.local");

      if (request.method === "GET" && url.pathname === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        return;
      }

      if (request.method === "GET" && url.pathname === "/webhook") {
        const challenge = verifyChallenge(url.searchParams, verifyToken);
        if (challenge === undefined) {
          response.writeHead(403).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/plain" }).end(challenge);
        return;
      }

      if (request.method === "POST" && url.pathname === "/webhook") {
        let body: Buffer;
        try {
          body = await rawBody(request);
        } catch {
          response.writeHead(413).end();
          return;
        }

        const header = request.headers["x-hub-signature-256"];
        if (!verifySignature(body, typeof header === "string" ? header : undefined, appSecret)) {
          log(`${new Date().toISOString()} webhook-rejected reason=signature`);
          response.writeHead(401).end();
          return;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(body.toString("utf8"));
        } catch {
          response.writeHead(400).end();
          return;
        }

        // Acknowledged before the work, so Meta does not retry and double-reply.
        response.writeHead(200).end();

        const work = handleDelivery(payload).finally(() => inFlight.delete(work));
        inFlight.add(work);
        await work;
        return;
      }

      response.writeHead(404).end();
    })();
  });

  return {
    server,
    whenIdle: async () => {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },
  };
}
