import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import * as messages from "../src/messages/index.ts";
import { readMessages } from "../src/whatsapp.ts";

// fileURLToPath, not .pathname: this repo's path has a space in it and arrives percent-encoded.
const MESSAGES_DIR = fileURLToPath(new URL("../src/messages", import.meta.url));

describe("formatting money", () => {
  it("prints naira the way a receipt does", () => {
    assert.equal(messages.naira(5_000_000n), "₦50,000");
    assert.equal(messages.naira(100n), "₦1");
    assert.equal(messages.naira(5_025n), "₦50.25");
    assert.equal(messages.naira(150_000_000_00n), "₦150,000,000");
  });

  it("prints dollars to the cent, never to six decimals", () => {
    assert.equal(messages.dollars(32_594_525n), "$32.59");
    assert.equal(messages.dollars(0n), "$0.00");
    assert.equal(messages.dollars(1_000_000n), "$1.00");
    assert.equal(messages.dollars(1_234_567_890n), "$1,234.56");
  });

  it("truncates rather than rounds up, so a balance is never overstated", () => {
    assert.equal(messages.dollars(999_999n), "$0.99");
  });
});

describe("the ban list", () => {
  // CLAUDE.md: a currency word in a bot message is a ban risk for the number under WhatsApp's
  // commerce policy. This is the same grep, run automatically so it cannot rot.
  const BANNED =
    /wallet|gas|blockchain|crypto|seed phrase|mnemonic|web3|on-chain|onchain|token|stablecoin|usdt|usdc|ausd|\bMON\b|monad|metamask|tx hash|transaction hash|sign(ing)? (a )?message/i;

  it("finds nothing in any message file", () => {
    for (const name of readdirSync(MESSAGES_DIR)) {
      const source = readFileSync(join(MESSAGES_DIR, name), "utf8");
      const hits = source
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => BANNED.test(entry.line));

      assert.deepEqual(hits, [], `${name} uses a word that can get the number banned`);
    }
  });

  it("finds nothing in the strings a sender actually receives", () => {
    const rendered = [
      messages.help(),
      messages.welcome(),
      messages.addContact("Mum", "https://rail.example/k/abc"),
      messages.addNeedsName(),
      messages.accountNumberInChat(),
      messages.contactList([
        { contactName: "Mum", accountName: "ADAEZE O. OKONKWO", bankName: "GTBank", accountLast4: "4567" },
      ]),
      messages.noContacts(),
      messages.unknownContact("granny"),
      messages.unreadableAmount(),
      messages.amountTooSmall(),
      messages.confirmSend({
        localAmount: 5_000_000n,
        contact: { contactName: "Mum", accountName: "ADAEZE O. OKONKWO", bankName: "GTBank", accountLast4: "4567" },
        indicativeUnits: 32_594_525n,
        url: "https://rail.example/c/ghi",
      }),
      messages.balance(32_594_525n),
      messages.linkAccount("https://rail.example/l/def"),
      messages.somethingWentWrong(),
    ];

    for (const text of rendered) {
      assert.equal(BANNED.test(text), false, text);
    }
  });

  it("never prints anything the length of an account number", () => {
    const contact = { contactName: "Mum", accountName: "ADAEZE O. OKONKWO", bankName: "GTBank", accountLast4: "4567" };
    for (const text of [messages.contactList([contact]), messages.confirmSend({ localAmount: 5_000_000n, contact, indicativeUnits: 1n, url: "u" })]) {
      assert.equal(/(?<!\d)\d{8,11}(?!\d)/.test(text), false, text);
    }
  });
});

describe("reading what Meta delivered", () => {
  const envelope = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });

  it("reads a text message", () => {
    const found = readMessages(envelope([{ from: "2349166358325", id: "wamid.1", type: "text", text: { body: "balance" } }]));
    assert.deepEqual(found, [{ waId: "2349166358325", text: "balance", messageId: "wamid.1" }]);
  });

  // A status callback is not a message, and replying to one would talk to nobody.
  it("ignores everything that is not a text message", () => {
    assert.deepEqual(readMessages(envelope([{ from: "234", id: "1", type: "image" }])), []);
    assert.deepEqual(readMessages({ entry: [{ changes: [{ value: { statuses: [{ id: "1" }] } }] }] }), []);
  });

  it("treats a malformed delivery as empty rather than throwing", () => {
    for (const payload of [undefined, null, {}, { entry: null }, { entry: [{}] }, "not json", 7]) {
      assert.deepEqual(readMessages(payload), [], JSON.stringify(payload ?? null));
    }
  });
});
