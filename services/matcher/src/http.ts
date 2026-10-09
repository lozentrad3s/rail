/**
 * The matcher's only HTTP surface: a health check, and the simulated bank's feed.
 *
 * Both are read-only. Nothing here can make the bot bid, pay or confirm anything, so there is no
 * authentication — and the feed holds no account numbers, only references and amounts.
 */
import { createServer } from "node:http";
import type { Address } from "viem";

import type { SimulatedBank } from "./bank.ts";

/** Past this, the bot is not watching the chain, whatever the process says. */
const STALE_HEAD_MS = 60_000;

export function serveHttp(
  port: number,
  state: { lp: Address; label: string; headAgeMs: () => number; bank?: SimulatedBank | undefined },
): void {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://matcher");
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        // Read by CRE nodes and by a judge's browser; neither sends credentials.
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify(body));
    };

    if (request.method !== "GET") return send(405, { error: { code: "BAD_REQUEST", message: "GET only" } });

    if (url.pathname === "/healthz") {
      const headAgeMs = state.headAgeMs();
      return send(200, {
        ok: headAgeMs < STALE_HEAD_MS,
        lp: state.lp,
        label: state.label,
        headAgeMs,
        simulatedPayout: state.bank !== undefined,
      });
    }

    if (url.pathname === "/simulated-bank/credits") {
      if (!state.bank) return send(404, { error: { code: "NOT_FOUND", message: "This provider pays manually." } });
      const narration = url.searchParams.get("narration") ?? "";
      const currency = url.searchParams.get("currency") ?? undefined;
      return send(200, { simulated: true, credits: state.bank.query(narration, currency) });
    }

    return send(404, { error: { code: "NOT_FOUND", message: "No such endpoint." } });
  });

  server.listen(port);
}
