import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Hex } from "viem";

import { createContactLink, getContact, listContacts, saveContact } from "../src/contacts.ts";
import { createDraft, readDraft } from "../src/drafts.ts";
import { Vault } from "../src/vault.ts";

const KEY = `0x${"22".repeat(32)}` as Hex;
const WA_ID = "2348012345678";
const APP = "https://rail.example";

const details = {
  currency: "NGN",
  bankCode: "058",
  bankName: "GTBank",
  accountNumber: "0001234567",
  accountName: "ADAEZE O. OKONKWO",
};

function withVault<T>(run: (vault: Vault, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "rail-vault-"));
  try {
    return run(new Vault(dir, KEY), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const addContact = (vault: Vault, contactName = "Mum") => {
  const { url } = createContactLink(vault, { waId: WA_ID, contactName }, APP);
  const token = url.split("/k/")[1] as string;
  return saveContact(vault, { token, ...details });
};

describe("contact links", () => {
  it("hands back a link instead of asking for an account number in chat", () => {
    withVault((vault) => {
      const { url } = createContactLink(vault, { waId: WA_ID, contactName: "Mum" }, APP);
      assert.match(url, /^https:\/\/rail\.example\/k\/[0-9a-f]{32}$/);
    });
  });

  it("is single use, so a forwarded link is dead", () => {
    withVault((vault) => {
      const { url } = createContactLink(vault, { waId: WA_ID, contactName: "Mum" }, APP);
      const token = url.split("/k/")[1] as string;

      saveContact(vault, { token, ...details });
      assert.throws(() => saveContact(vault, { token, ...details }), /expired or has already been used/);
    });
  });

  it("refuses a token that was never issued", () => {
    withVault((vault) => {
      assert.throws(() => saveContact(vault, { token: "deadbeef", ...details }), /expired/);
    });
  });
});

describe("listing contacts", () => {
  it("never exposes the full account number", () => {
    withVault((vault) => {
      addContact(vault);
      const [summary] = listContacts(vault, WA_ID);

      // The chat may show ····4567 and nothing more: Meta's policy forbids account numbers in chat.
      assert.equal(summary?.accountLast4, "4567");
      assert.equal(JSON.stringify(summary).includes("0001234567"), false);
    });
  });

  it("keeps one sender's contacts away from another's", () => {
    withVault((vault) => {
      addContact(vault);
      assert.equal(listContacts(vault, "2349990000000").length, 0);
    });
  });

  it("writes no phone number into a filename", () => {
    withVault((vault, dir) => {
      addContact(vault);
      const names = readdirSync(dir).join(" ");
      assert.equal(names.includes(WA_ID), false, "a directory listing must not be a list of numbers");
    });
  });

  it("stores no bank details in the clear", () => {
    withVault((vault, dir) => {
      addContact(vault);
      const onDisk = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join();
      assert.equal(onDisk.includes("0001234567"), false);
      assert.equal(onDisk.includes("ADAEZE"), false);
    });
  });
});

describe("drafts", () => {
  it("proposes a payment the app must still confirm", () => {
    withVault((vault) => {
      const contact = addContact(vault);
      const draft = createDraft(
        vault,
        { waId: WA_ID, contactId: contact.contactId, currency: "NGN", localAmount: 5_000_000n },
        APP,
      );

      // 128 bits, because the id travels in a URL.
      assert.match(draft.url, /^https:\/\/rail\.example\/c\/[0-9a-f]{32}$/);

      const detail = readDraft(vault, draft.draftId);
      assert.equal(detail.localAmount, "5000000");
      // The app is the only place the full number appears, so the sender can check it before Face ID.
      assert.equal(detail.recipient.accountNumber, "0001234567");
      assert.equal(detail.recipient.accountName, "ADAEZE O. OKONKWO");
    });
  });

  it("refuses a contact that belongs to someone else", () => {
    withVault((vault) => {
      const contact = addContact(vault);
      assert.throws(
        () =>
          createDraft(
            vault,
            { waId: "2349990000000", contactId: contact.contactId, currency: "NGN", localAmount: 1_000n },
            APP,
          ),
        /No such contact/,
      );
    });
  });

  it("refuses a zero or negative amount", () => {
    withVault((vault) => {
      const contact = addContact(vault);
      assert.throws(
        () => createDraft(vault, { waId: WA_ID, contactId: contact.contactId, currency: "NGN", localAmount: 0n }, APP),
        /must be positive/,
      );
    });
  });

  it("expires, so a stale request cannot be signed hours later", () => {
    withVault((vault, dir) => {
      const contact = addContact(vault);
      const draft = createDraft(
        vault,
        { waId: WA_ID, contactId: contact.contactId, currency: "NGN", localAmount: 5_000_000n },
        APP,
      );

      // Rewind the stored expiry rather than waiting fifteen minutes.
      const file = join(dir, `draft_${draft.draftId}.json`);
      const stored = JSON.parse(readFileSync(file, "utf8")) as { expiresAt: number };
      stored.expiresAt = Math.floor(Date.now() / 1000) - 1;
      writeFileSync(file, JSON.stringify(stored));

      assert.throws(() => readDraft(vault, draft.draftId), /expired/);
    });
  });
});

describe("contact records", () => {
  it("keeps the full details for building a draft", () => {
    withVault((vault) => {
      const summary = addContact(vault);
      assert.equal(getContact(vault, WA_ID, summary.contactId).accountNumber, "0001234567");
    });
  });
});
