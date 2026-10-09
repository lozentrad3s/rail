import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { parseAmount } from "../src/amounts.ts";
import { parseResult, redact, usesBannedWord, type AssistantResult } from "../src/assistant.ts";
import { replyTo, type Deps } from "../src/handle.ts";
import * as messages from "../src/messages/index.ts";
import { RelayerClient } from "../src/relayer.ts";
import { understand } from "../src/understand.ts";

describe("understanding people", () => {
  const sends: [string, bigint, string][] = [
    ["can you send 20k to my mum please", 2_000_000n, "mum"],
    ["pls transfer 5,000 naira to dad", 500_000n, "dad"],
    ["send mum 20k", 2_000_000n, "mum"],
    ["I want to send 20 thousand to my sister", 2_000_000n, "sister"],
    ["pay my landlord ₦150,000", 15_000_000n, "landlord"],
  ];
  for (const [text, minor, name] of sends) {
    it(`reads "${text}" as a send`, () => {
      assert.deepEqual(understand(text), { kind: "send", localAmount: minor, contactName: name });
    });
  }

  it("asks how much when only the person is named", () => {
    assert.deepEqual(understand("send money to my mum"), { kind: "send-needs-amount", contactName: "mum" });
  });

  it("reads everyday questions as the intents they are", () => {
    assert.equal(understand("how much do I have?")?.kind, "balance");
    assert.equal(understand("who can I send to")?.kind, "contacts");
    assert.equal(understand("what's the rate today")?.kind, "rate");
    assert.deepEqual(understand("could you add my brother"), { kind: "add", contactName: "brother" });
  });

  it("answers the questions people ask before trusting a money app", () => {
    const topic = (text: string) => {
      const understood = understand(text);
      return understood?.kind === "answer" ? understood.topic : understood?.kind;
    };
    assert.equal(topic("is this safe?"), "safety");
    assert.equal(topic("what if the provider doesn't pay?"), "provider-fails");
    assert.equal(topic("how long does it take"), "speed");
    assert.equal(topic("are there any fees"), "cost");
    assert.equal(topic("my money is stuck"), "no-provider");
    assert.equal(topic("can I send to Ghana"), "corridors");
    assert.equal(topic("does my mum need an app"), "recipient");
    assert.equal(topic("are you a bot"), "who");
    assert.equal(topic("how does this work"), "how");
    assert.equal(topic("thanks!"), "thanks");
  });

  it("does not mistake 'help us' for a question about the United States", () => {
    assert.equal(understand("can you help us"), undefined);
  });

  it("reads amounts the way they are said", () => {
    assert.equal(parseAmount("20 thousand"), 2_000_000n);
    assert.equal(parseAmount("2 million naira"), 200_000_000n);
  });

  it("never answers with machinery words", () => {
    // Every written answer passes the same check CLAUDE.md greps for.
    for (const answer of Object.values(messages.answers)) assert.equal(usesBannedWord(answer()), false);
    assert.equal(usesBannedWord(messages.help()), false);
    assert.equal(usesBannedWord(messages.welcome()), false);
    assert.equal(usesBannedWord(messages.offTopic()), false);
  });

  it("never says the transfer is guaranteed or instant", () => {
    // Attack on honesty: copy that promises what the mechanism does not.
    for (const answer of Object.values(messages.answers)) assert.doesNotMatch(answer(), /guaranteed|risk-free|instantly/i);
  });
});

describe("the assistant's boundaries", () => {
  it("strips an account number before any text leaves for the model", () => {
    // Attack: a sender pastes a NUBAN and it ends up in a third party's logs.
    const out = redact("send 20k to 0123456789 at gtbank, or 0123 456 789");
    assert.doesNotMatch(out, /0123456789|0123 456 789/);
    assert.match(out, /20k/, "amounts are short enough to survive");
  });

  it("refuses an intent it was never offered", () => {
    // Attack: the model is talked into a made-up action like "approve" or "withdraw".
    assert.equal(parseResult(JSON.stringify({ intent: "approve" })), undefined);
    assert.equal(parseResult("not json"), undefined);
  });

  it("drops a reply that uses the machinery's vocabulary", () => {
    const result = parseResult(JSON.stringify({ intent: "answer", reply: "It settles in AUSD on Monad." }));
    assert.equal(result?.reply, undefined);
  });
});

describe("a conversation with the assistant behind it", () => {
  let server: Server;
  let base: Omit<Deps, "assistant">;
  const calls: string[] = [];

  before(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://stub.local");
      calls.push(url.pathname);
      const json = (body: unknown) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (url.pathname === "/v1/contacts") {
        return json([{ contactId: "c1", contactName: "Mum", accountName: "ADAEZE O.", bankName: "GTBank", accountLast4: "4567" }]);
      }
      if (url.pathname === "/v1/drafts") return json({ draftId: "d1", url: "https://rail.example/c/ghi" });
      if (url.pathname === "/v1/quote") return json({ indicativeAusd: "15000000", maxAusd: "15300000" });
      return json({});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    base = { relayer: new RelayerClient(`http://127.0.0.1:${port}`, "k"), readBalance: async () => 0n, currency: "NGN" };
  });
  after(() => server.close());

  const withAssistant = (result: AssistantResult | undefined, seen?: string[]): Deps => ({
    ...base,
    assistant: async (text) => {
      seen?.push(text);
      return result;
    },
  });

  it("turns what the model understood into the same draft-and-link a typed send makes", async () => {
    calls.length = 0;
    const reply = await replyTo(
      withAssistant({ intent: "send", amount: "20k", contact: "Mum" }),
      "tg:1",
      "abeg help me push twenty k to mama",
    );
    assert.match(reply, /https:\/\/rail\.example\/c\/ghi/);
    assert.match(reply, /Face ID/);
    assert.ok(calls.includes("/v1/drafts"), "it proposes; approval still happens on the phone");
    assert.ok(!calls.some((path) => path.includes("/orders")), "nothing here can submit an order");
  });

  it("uses our words, not the model's, for anything off-topic", async () => {
    const reply = await replyTo(
      withAssistant({ intent: "off_topic", reply: "Sure! Here's a poem about the sea..." }),
      "tg:1",
      "write me a poem",
    );
    assert.equal(reply, messages.offTopic());
  });

  it("is only asked about what the other layers could not read", async () => {
    const seen: string[] = [];
    await replyTo(withAssistant({ intent: "balance" }, seen), "tg:1", "is this safe?");
    assert.deepEqual(seen, [], "a question understand.ts answers never leaves the process");
  });

  it("falls back to help when the model is down", async () => {
    assert.equal(await replyTo(withAssistant(undefined), "tg:1", "qwerty zxcv"), messages.help());
  });
});
