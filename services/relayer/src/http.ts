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

/** Big numbers go over the wire as decimal strings, never as JSON numbers (docs §1). */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

export class Router {
  readonly #routes: Route[] = [];

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

      response.writeHead(200, { "content-type": "application/json" });
      response.end(serialise(result));
    } catch (cause) {
      const error = toRelayerError(cause);
      if (error.code === "INTERNAL") console.error("unhandled", cause);

      response.writeHead(error.status, { "content-type": "application/json" });
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
