import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { createAccountLink, getLinkedAccount, linkAccount, linkMessage } from "../src/accounts.ts";
import { Vault } from "../src/vault.ts";

const KEY = `0x${"33".repeat(32)}` as Hex;
const WA_ID = "2349166358325";
const APP = "https://rail.example";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const attacker = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);

// Every case here is async, so the directory has to outlive the promise, not the call.
async function withVault(run: (vault: Vault, dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "rail-accounts-"));
  try {
    await run(new Vault(dir, KEY), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tokenFrom = (url: string): string => url.split("/l/")[1] as string;

const sign = (token: string, address: string, as = owner) =>
  as.signMessage({ message: linkMessage(token, address) });

describe("account links", () => {
  it("hands the bot a link, never an address to type", async () => {
    await withVault(async (vault) => {
      const { url } = createAccountLink(vault, WA_ID, APP);
      assert.match(url, /^https:\/\/rail\.example\/l\/[0-9a-f]{32}$/);
    });
  });

  it("binds the number once the account proves it holds the key", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      const linked = await linkAccount(vault, {
        token,
        address: owner.address,
        signature: await sign(token, owner.address),
      });

      assert.equal(linked.waId, WA_ID);
      assert.equal(linked.address, owner.address);
      assert.equal(getLinkedAccount(vault, WA_ID)?.address, owner.address);
    });
  });
});

describe("account link attacks", () => {
  // Stealing the WhatsApp number does not let you point it at your own account: you still
  // need a signature, and the bot has never been able to produce one.
  it("refuses an address the signature does not cover", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await assert.rejects(
        linkAccount(vault, {
          token,
          address: owner.address,
          signature: await sign(token, owner.address, attacker),
        }),
        /does not match the account/,
      );
      assert.equal(getLinkedAccount(vault, WA_ID), undefined);
    });
  });

  // Signing for your own address under someone else's token must not rebind their number.
  it("refuses a signature made over a different token", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await assert.rejects(
        linkAccount(vault, {
          token,
          address: attacker.address,
          signature: await sign("a-different-token", attacker.address, attacker),
        }),
        /does not match the account/,
      );
    });
  });

  // A link pasted into a group chat is dead the moment its owner uses it.
  it("is single use", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      const signature = await sign(token, owner.address);
      await linkAccount(vault, { token, address: owner.address, signature });

      await assert.rejects(
        linkAccount(vault, { token, address: owner.address, signature }),
        /expired/,
      );
    });
  });

  // A failed attempt must not burn the real owner's link.
  it("survives a bad signature and still links afterwards", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await assert.rejects(
        linkAccount(vault, {
          token,
          address: owner.address,
          signature: await sign(token, owner.address, attacker),
        }),
      );

      const linked = await linkAccount(vault, {
        token,
        address: owner.address,
        signature: await sign(token, owner.address),
      });
      assert.equal(linked.address, owner.address);
    });
  });

  it("refuses a token that was never issued", async () => {
    await withVault(async (vault) => {
      await assert.rejects(
        linkAccount(vault, {
          token: "deadbeef",
          address: owner.address,
          signature: await sign("deadbeef", owner.address),
        }),
        /expired/,
      );
    });
  });

  it("refuses malformed signature bytes rather than throwing", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await assert.rejects(
        linkAccount(vault, { token, address: owner.address, signature: "0x1234" as Hex }),
        /does not match the account/,
      );
    });
  });

  it("expires, so a link left in a chat overnight is worthless", async () => {
    await withVault(async (vault, dir) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);

      // Rewind the stored expiry rather than waiting fifteen minutes.
      const file = join(dir, `alink_${token}.json`);
      const stored = JSON.parse(readFileSync(file, "utf8")) as { expiresAt: number };
      stored.expiresAt = Math.floor(Date.now() / 1000) - 1;
      writeFileSync(file, JSON.stringify(stored));

      await assert.rejects(
        linkAccount(vault, {
          token,
          address: owner.address,
          signature: await sign(token, owner.address),
        }),
        /expired/,
      );
    });
  });
});

describe("account link storage", () => {
  it("writes no phone number into a filename", async () => {
    await withVault(async (vault, dir) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await linkAccount(vault, {
        token,
        address: owner.address,
        signature: await sign(token, owner.address),
      });

      assert.equal(readdirSync(dir).join(" ").includes(WA_ID), false);
    });
  });

  it("keeps one number's account away from another's", async () => {
    await withVault(async (vault) => {
      const token = tokenFrom(createAccountLink(vault, WA_ID, APP).url);
      await linkAccount(vault, {
        token,
        address: owner.address,
        signature: await sign(token, owner.address),
      });

      assert.equal(getLinkedAccount(vault, "2340000000000"), undefined);
    });
  });
});
