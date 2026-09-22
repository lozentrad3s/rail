/**
 * A small router over `node:http`.
 *
 * No framework: the surface is a dozen endpoints, and every dependency on a payments service is
 * something else to keep patched.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { RelayerError, toRelayerError } from "./errors.ts";

export type Handler = (context: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  request: IncomingMessage;
}) => Promise<unknown>;

type Route = { method: string; pattern: string[]; handler: Handler };

export type RouterOptions = {
  /** Origins the app may call from. Never `*`: an allowlist is the only defensible answer. */
  allowedOrigins?: string[];
};

/**
 * CORS headers for this request, or none.
 *
 * An origin that is not on the list gets nothing back, which is what stops a page on some other
 * site reading a sender's contacts out of their browser. It is not what protects the bot's own
 * endpoints — CORS only binds browsers, and their shared secret does that job.
 */
function corsHeaders(
  origin: string | undefined,
  allowed: string[],
): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    // The origin decides the response, so caches must not serve one origin's answer to another.
    vary: "Origin",
  };
}

/** Big numbers go over the wire as decimal strings, never as JSON numbers (docs §1). */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

export class Router {
  readonly #routes: Route[] = [];
  readonly #allowedOrigins: string[];

  constructor(options: RouterOptions = {}) {
    this.#allowedOrigins = options.allowedOrigins ?? [];
  }

  add(method: string, path: string, handler: Handler): this {
    this.#routes.push({ method, pattern: path.split("/").filter(Boolean), handler });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.add("POST", path, handler);
  }

  #match(method: string, segments: string[]): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.#routes) {
      if (route.method !== method || route.pattern.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, part] of route.pattern.entries()) {
        const actual = segments[index] ?? "";
        if (part.startsWith(":")) params[part.slice(1)] = actual;
        else if (part !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return undefined;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const cors = corsHeaders(origin, this.#allowedOrigins);

    // The preflight never reaches a handler: it asks permission, it does not do anything.
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }

    const match = this.#match(request.method ?? "GET", segments);

    try {
      if (!match) throw new RelayerError("NOT_FOUND", "No such endpoint.");

      const body = await readJson(request);
      const result = await match.route.handler({
        params: match.params,
        query: url.searchParams,
        body,
        request,
      });

      response.writeHead(200, { "content-type": "application/json", ...cors });
      response.end(serialise(result));
    } catch (cause) {
      const error = toRelayerError(cause);
      if (error.code === "INTERNAL") console.error("unhandled", cause);

      // Errors carry the headers too, or the browser reports a CORS failure instead of the reason.
      response.writeHead(error.status, { "content-type": "application/json", ...cors });
      response.end(serialise(error.toJSON()));
    }
  }
}

/** Reads a JSON body, with a cap so a single request cannot exhaust memory. */
async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.method !== "POST" && request.method !== "PATCH") return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new RelayerError("BAD_REQUEST", "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RelayerError("BAD_REQUEST", "Request body is not valid JSON.");
  }
}
