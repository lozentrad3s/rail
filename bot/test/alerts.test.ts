import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { AlertSubscribers, NewRequests, type OpenRequest } from "../src/alerts.ts";
import { usesBannedWord } from "../src/assistant.ts";
import { parseCommand } from "../src/commands.ts";
import { replyTo, type Deps } from "../src/handle.ts";
import * as messages from "../src/messages/index.ts";
import { RelayerClient } from "../src/relayer.ts";

const request = (id: string): OpenRequest => ({ id, localAmount: 5_000_000n, maxAusd: 38_317_056n, commitEnd: 100n });

describe("provider alerts", () => {
  it("understands the ways a provider asks for them", () => {
    for (const text of ["alerts", "Alerts on", "/alerts", "/start alerts", "provider alerts"]) {
      assert.equal(parseCommand(text).kind, "alerts-on", text);
    }
    for (const text of ["alerts off", "stop alerts", "/alerts off"]) {
      assert.equal(parseCommand(text).kind, "alerts-off", text);
    }
  });

  it("never replays a backlog: the first look only learns what already exists", () => {
    // A restart must not message every subscriber about requests that are half over.
    const fresh = new NewRequests();
    assert.deepEqual(fresh.take([request("a"), request("b")]), []);
    assert.deepEqual(fresh.take([request("a"), request("b"), request("c")]).map((r) => r.id), ["c"]);
    assert.deepEqual(fresh.take([request("c")]), [], "each request is announced once");
  });

  it("keeps subscribers across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "alerts-")), "alerts.json");
    new AlertSubscribers(file).subscribe("tg:1");
    const again = new AlertSubscribers(file);
    assert.deepEqual(again.all, ["tg:1"]);
    again.unsubscribe("tg:1");
    assert.deepEqual(new AlertSubscribers(file).all, []);
  });

  it("says only public facts, in words a chat may use", () => {
    const text = messages.providerAlert({
      localAmount: 5_000_000n,
      ceilingUnits: 38_317_056n,
      secondsLeft: 41,
      url: "https://rail-pay.vercel.app/provider",
    });
    assert.match(text, /₦50,000/);
    assert.match(text, /\$38\.31/);
    assert.equal(usesBannedWord(text), false);
    assert.equal(usesBannedWord(messages.alertsOn("https://rail-pay.vercel.app/provider")), false);
  });

  it("subscribes the chat that asked, and only on a transport that can message first", async () => {
    const subscribers = new AlertSubscribers(join(mkdtempSync(join(tmpdir(), "alerts-")), "a.json"));
    const base: Deps = { relayer: new RelayerClient("http://127.0.0.1:9", "k"), readBalance: async () => 0n, currency: "NGN" };

    assert.match(await replyTo({ ...base, alerts: subscribers }, "tg:7", "alerts"), /Alerts are on/);
    assert.deepEqual(subscribers.all, ["tg:7"]);
    assert.equal(await replyTo(base, "2349166358325", "alerts"), messages.alertsUnavailable());
  });
});

describe("examples that are not all about mum", () => {
  it("shows more than one kind of person to add", () => {
    // Somebody who only ever reads "add mum" can fairly conclude Rail only sends to mums.
    for (const text of [messages.welcome(), messages.noContacts(), messages.addNeedsName()]) {
      assert.match(text, /add dad|add my/i, text);
    }
  });
});
