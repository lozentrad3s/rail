/**
 * Telegram transport.
 *
 * The parser is the interesting part: Telegram delivers edits, joins, photos, service messages and
 * other bots' chatter down the same channel as commands, and a bot that answers the wrong one of
 * those is either silent when it should speak or looping with another bot.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chatIdFor, readUpdates, TELEGRAM_MAX_BODY } from "../src/telegram.ts";
import { fit } from "../src/server.ts";

const message = (overrides: Record<string, unknown> = {}) => ({
  update_id: 100,
  message: { chat: { id: 7301234567 }, text: "balance", from: { is_bot: false }, ...overrides },
});

describe("reading what Telegram delivered", () => {
  it("reads a text message from a long poll", () => {
    const found = readUpdates({ ok: true, result: [message()] });
    assert.deepEqual(found, [
      { updateId: 100, chatId: "tg:7301234567", text: "balance", telegramChatId: 7301234567 },
    ]);
  });

  // A webhook POSTs one bare Update rather than a result array. One parser must take both.
  it("reads a bare update from a webhook", () => {
    const found = readUpdates(message());
    assert.equal(found.length, 1);
    assert.equal(found[0]!.chatId, "tg:7301234567");
  });

  it("reads several updates in arrival order", () => {
    const found = readUpdates({
      result: [message({}), { update_id: 101, message: { chat: { id: 42 }, text: "help" } }],
    });
    assert.deepEqual(
      found.map((update) => update.updateId),
      [100, 101],
    );
  });
});

describe("what the parser must ignore", () => {
  // Answering another bot is a loop that bills both of us until someone notices.
  it("ignores messages from other bots", () => {
    assert.deepEqual(readUpdates({ result: [message({ from: { is_bot: true } })] }), []);
  });

  // A photo, a sticker, a voice note and a service message are not commands.
  it("ignores anything with no text", () => {
    for (const payload of [
      { result: [{ update_id: 1, message: { chat: { id: 5 } } }] },
      { result: [{ update_id: 1, message: { chat: { id: 5 }, text: "" } }] },
      { result: [{ update_id: 1, message: { chat: { id: 5 }, photo: [{ file_id: "x" }] } }] },
      { result: [{ update_id: 1, edited_message: { chat: { id: 5 }, text: "hi" } }] },
      { result: [{ update_id: 1, my_chat_member: { chat: { id: 5 } } }] },
    ]) {
      assert.deepEqual(readUpdates(payload), [], JSON.stringify(payload));
    }
  });

  it("ignores an update with no id to acknowledge", () => {
    assert.deepEqual(readUpdates({ result: [{ message: { chat: { id: 5 }, text: "hi" } }] }), []);
  });

  it("treats malformed payloads as empty rather than throwing", () => {
    for (const payload of [undefined, null, {}, { result: null }, { result: [null] }, "nope", 7, []]) {
      assert.deepEqual(readUpdates(payload), [], JSON.stringify(payload ?? null));
    }
  });
});

describe("namespacing", () => {
  // A Telegram chat id is a number and so is a phone number. Without a prefix, one relayer serving
  // both transports is one collision away from handing a stranger someone else's contacts.
  it("cannot collide with a phone number", () => {
    assert.equal(chatIdFor(2349166358325), "tg:2349166358325");
    assert.notEqual(chatIdFor(2349166358325), "2349166358325");
  });

  it("is stable for the same chat", () => {
    assert.equal(chatIdFor(7301234567), chatIdFor("7301234567"));
  });
});

describe("message length", () => {
  // Telegram rejects a text message over 4096 characters outright, which would leave a sender
  // waiting with nothing — worse than a shortened reply.
  it("cuts a reply to what Telegram accepts", () => {
    const cut = fit("x".repeat(9000), TELEGRAM_MAX_BODY);
    assert.equal(cut.length, TELEGRAM_MAX_BODY);
    assert.ok(cut.endsWith("…"));
  });

  it("leaves a short reply untouched", () => {
    assert.equal(fit("You have $115.97.", TELEGRAM_MAX_BODY), "You have $115.97.");
  });
});
