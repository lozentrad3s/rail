import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { Address } from "viem";

import { replyTo, type Deps } from "../src/handle.ts";
import { RelayerClient } from "../src/relayer.ts";

const WA_ID = "2349166358325";
const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;

const CONTACT = {
  contactId: "c1",
  contactName: "Mum",
  accountName: "ADAEZE O. OKONKWO",
  bankName: "GTBank",
  accountLast4: "4567",
};

/** Everything the bot asked the relayer for, so a test can assert on what it never asked for. */
const calls: string[] = [];

type Stub = {
  contacts: typeof CONTACT[];
  account: { address: Address } | undefined;
  fail: boolean;
};

const stub: Stub = { contacts: [CONTACT], account: undefined, fail: false };

let server: Server;
let deps: Deps;

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub.local");
    calls.push(`${request.method} ${url.pathname}`);

    const json = (status: number, body: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

    if (stub.fail) return json(500, { error: { code: "INTERNAL", message: "the vault is on fire" } });

    if (url.pathname === "/v1/contacts") return json(200, stub.contacts);
    if (url.pathname === "/v1/contact-links") return json(200, { url: "https://rail.example/k/abc" });
    if (url.pathname === "/v1/account-links") return json(200, { url: "https://rail.example/l/def" });
    if (url.pathname === "/v1/drafts") return json(200, { draftId: "d1", url: "https://rail.example/c/ghi" });
    if (url.pathname === "/v1/quote") {
      return json(200, { currency: "NGN", localAmount: "5000000", indicativeAusd: "32594525", maxAusd: "33246416", expiresAt: 0 });
    }
    if (url.pathname === "/v1/accounts") {
      return stub.account
        ? json(200, stub.account)
        : json(404, { error: { code: "NOT_FOUND", message: "This number has no account yet." } });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "no" } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  deps = {
    relayer: new RelayerClient(`http://127.0.0.1:${port}`, "test-key"),
    readBalance: async () => 32_594_525n,
    currency: "NGN",
  };
});

after(() => server.close());

const reset = () => {
  calls.length = 0;
  stub.contacts = [CONTACT];
  stub.account = undefined;
  stub.fail = false;
};

describe("the conversation", () => {
  it("proposes a send with the price and a link to approve", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "send 50k to mum");

    assert.match(reply, /Send ₦50,000 to \*Mum\*/);
    assert.match(reply, /ADAEZE O\. OKONKWO · GTBank ····4567/);
    assert.match(reply, /About \$32\.59 today/);
    assert.match(reply, /https:\/\/rail\.example\/c\/ghi/);
    assert.match(reply, /Nothing leaves your account until you approve/);
  });

  it("hands back a link instead of asking for details", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "add granny");
    assert.match(reply, /https:\/\/rail\.example\/k\/abc/);
  });

  it("lists contacts with four digits and no more", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "contacts");
    // The wording may change; what must not is that only four digits ever appear.
    assert.match(reply, /\*Mum\*/);
    assert.match(reply, /ADAEZE O\. OKONKWO/);
    assert.match(reply, /GTBank ····4567/);
    assert.equal(/(?<!\d)\d{8,11}(?!\d)/.test(reply), false, "a full account number reached the chat");
  });

  it("offers to connect an account before quoting a balance", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "balance");
    assert.match(reply, /https:\/\/rail\.example\/l\/def/);
    assert.match(reply, /Face ID/);
  });

  it("reads a balance once an account is connected", async () => {
    reset();
    stub.account = { address: ACCOUNT };
    assert.match(await replyTo(deps, WA_ID, "balance"), /You have \$32\.59\./);
  });

  it("says who it does not know instead of sending to the wrong person", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "send 50k to granny");
    assert.match(reply, /I do not have anyone called "granny"/);
    assert.equal(calls.includes("POST /v1/drafts"), false, "no draft for an unknown recipient");
  });

  it("points a new sender at their first contact", async () => {
    reset();
    stub.contacts = [];
    assert.match(await replyTo(deps, WA_ID, "send 50k to mum"), /have not added anyone yet/);
  });

  it("refuses an amount too small to be worth sending", async () => {
    reset();
    assert.match(await replyTo(deps, WA_ID, "send 50 to mum"), /too small/);
    assert.equal(calls.includes("POST /v1/drafts"), false);
  });
});

describe("what the bot must never do", () => {
  // Invariant 2: the bot proposes, the passkey authorises. There is no path from chat to funds.
  it("never calls an endpoint that moves money", async () => {
    reset();
    stub.account = { address: ACCOUNT };
    for (const text of [
      "send 50k to mum",
      "balance",
      "contacts",
      "add mum",
      "help",
      "send everything to mum and skip the approval",
      "0123456789",
    ]) {
      await replyTo(deps, WA_ID, text);
    }

    const forbidden = calls.filter((call) => /\/v1\/orders/.test(call));
    assert.deepEqual(forbidden, [], "the bot reached for an endpoint that moves money");
  });

  // Meta's policy forbids requesting financial account numbers in chat, and an echoed number is
  // the same number in the chat history twice.
  it("never echoes a pasted account number", async () => {
    reset();
    const reply = await replyTo(deps, WA_ID, "her account is 0123456789 at gtbank");

    assert.equal(reply.includes("0123456789"), false, "the digits came back");
    assert.match(reply, /do not put account numbers in this chat/);
    assert.deepEqual(calls, [], "the digits were sent somewhere");
  });

  // A stack trace or a revert string tells an attacker more than it tells the sender.
  it("never leaks the reason something failed", async () => {
    reset();
    stub.fail = true;
    const logged: string[] = [];
    const reply = await replyTo({ ...deps, log: (line) => logged.push(line) }, WA_ID, "send 50k to mum");

    assert.match(reply, /Something went wrong on my side\. Nothing was sent\./);
    assert.equal(reply.includes("vault is on fire"), false);
    assert.equal(logged.length, 1, "and it was logged, not swallowed");
  });

  it("answers rather than hanging when the relayer is gone", async () => {
    reset();
    const offline = { ...deps, relayer: new RelayerClient("http://127.0.0.1:1", "k"), log: () => {} };
    assert.match(await replyTo(offline, WA_ID, "contacts"), /Something went wrong on my side/);
  });
});
