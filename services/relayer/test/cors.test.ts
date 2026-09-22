/**
 * Who may call this from a browser.
 *
 * The app runs on a different origin to the relayer, so it needs CORS to work at all. The risk is
 * granting it too widely: a page on any other site could then read a sender's contacts and drafts
 * out of their browser.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { Router } from "../src/http.ts";

const APP = "https://rail.money";

let server: Server;
let base: string;

before(async () => {
  const router = new Router({ allowedOrigins: [APP] })
    .get("/v1/thing", async () => ({ ok: true }))
    .post("/v1/thing", async () => ({ ok: true }));

  server = createServer((request, response) => void router.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const call = (path: string, init?: RequestInit & { origin?: string }) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init?.origin ? { origin: init.origin } : {}), ...init?.headers },
  });

describe("the app's own origin", () => {
  it("is allowed to read", async () => {
    const response = await call("/v1/thing", { origin: APP });
    assert.equal(response.headers.get("access-control-allow-origin"), APP);
  });

  it("gets a preflight it can act on", async () => {
    const response = await call("/v1/thing", { method: "OPTIONS", origin: APP });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), APP);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
  });

  // Without headers on the error, a browser reports "CORS failure" and hides the real reason.
  it("can read why something failed", async () => {
    const response = await call("/v1/nothing-here", { origin: APP });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("access-control-allow-origin"), APP);
  });
});

describe("everyone else", () => {
  // A page on another site must not be able to read a sender's contacts out of their browser.
  it("is refused, and not with a wildcard", async () => {
    const response = await call("/v1/thing", { origin: "https://evil.example" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  it("gets nothing from a preflight either", async () => {
    const response = await call("/v1/thing", { method: "OPTIONS", origin: "https://evil.example" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  // A prefix match would let rail.money.evil.example through.
  it("cannot pass by looking like the real origin", async () => {
    for (const origin of [
      "https://rail.money.evil.example",
      "https://rail.moneyy",
      "http://rail.money",
      "https://evil.example/https://rail.money",
    ]) {
      const response = await call("/v1/thing", { origin });
      assert.equal(response.headers.get("access-control-allow-origin"), null, origin);
    }
  });

  // Server-to-server calls carry no Origin, and must not be handed one back.
  it("gets no headers when there is no origin at all", async () => {
    const response = await call("/v1/thing");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

describe("the preflight itself", () => {
  // OPTIONS asks permission. It must never reach a handler and do something.
  it("never runs a handler", async () => {
    let ran = false;
    const router = new Router({ allowedOrigins: [APP] }).post("/v1/danger", async () => {
      ran = true;
      return { ok: true };
    });

    const probe = createServer((request, response) => void router.handle(request, response));
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;

    await fetch(`http://127.0.0.1:${port}/v1/danger`, {
      method: "OPTIONS",
      headers: { origin: APP },
    });

    assert.equal(ran, false);
    probe.close();
  });

  it("tells caches the answer depends on the origin", async () => {
    const response = await call("/v1/thing", { origin: APP });
    assert.match(response.headers.get("vary") ?? "", /Origin/i);
  });
});
