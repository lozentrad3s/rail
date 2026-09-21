/**
 * Encrypted storage for anything that would be harmful to leak.
 *
 * Bank details, contact lists and drafts all describe real people and real accounts. None of it
 * belongs on the chain (invariant 3), so it lives here instead — encrypted at rest, with keys that
 * are hashed so a directory listing is not a list of phone numbers.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";

import { RelayerError } from "./errors.ts";

type Envelope = { iv: string; tag: string; body: string; expiresAt?: number };

/** A phone number must never appear in a filename. */
export function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export class Vault {
  readonly #dir: string;
  readonly #key: Buffer;

  constructor(dir: string, keyHex: Hex) {
    this.#key = Buffer.from(keyHex.slice(2), "hex");
    if (this.#key.length !== 32) throw new RelayerError("INTERNAL", "encryption key must be 32 bytes");
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  #path(key: string): string {
    return join(this.#dir, `${key}.json`);
  }

  /** Stores a value, optionally with a lifetime after which it reads as absent. */
  put(key: string, value: unknown, options?: { expiresAt?: number }): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);

    const envelope: Envelope = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      body: body.toString("base64"),
      ...(options?.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    };
    writeFileSync(this.#path(key), JSON.stringify(envelope), { flush: true });
  }

  get<T>(key: string): T | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.#path(key), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new RelayerError("INTERNAL", "could not read stored data", { cause });
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch (cause) {
      throw new RelayerError("INTERNAL", "stored data is corrupt", { cause });
    }

    // Expiry is checked before decryption: an expired link is gone whether or not it decrypts.
    if (envelope.expiresAt !== undefined && Date.now() / 1000 > envelope.expiresAt) return undefined;

    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(envelope.body, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plain.toString("utf8")) as T;
    } catch (cause) {
      // A failed tag check means the file was altered. Never trust it.
      throw new RelayerError("INTERNAL", "stored data could not be decrypted", { cause });
    }
  }

  /** Everything stored under a key prefix, skipping anything expired. */
  list<T>(prefix: string): T[] {
    let names: string[];
    try {
      names = readdirSync(this.#dir);
    } catch {
      return [];
    }

    const found: T[] = [];
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      const value = this.get<T>(name.slice(0, -".json".length));
      if (value !== undefined) found.push(value);
    }
    return found;
  }

  /** Used for single-use links: reading one consumes it. */
  take<T>(key: string): T | undefined {
    const value = this.get<T>(key);
    if (value !== undefined) this.delete(key);
    return value;
  }

  delete(key: string): void {
    try {
      unlinkSync(this.#path(key));
    } catch {
      // Already gone is the desired state.
    }
  }
}
