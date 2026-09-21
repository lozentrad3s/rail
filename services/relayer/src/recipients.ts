/**
 * Recipient bank details, encrypted at rest.
 *
 * The chain only ever sees a salted hash (invariant 3). But the winning provider has to be told
 * where to send the naira, so the details live here, keyed by order id, encrypted with a key that
 * is not in the repository. A stolen database file is not a list of bank accounts.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Hex,
} from "viem";

import { RelayerError } from "./errors.ts";

export type Recipient = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  /** 32 random bytes from the sender's device. Never derived, never reused. */
  salt: Hex;
};

/**
 * The commitment that goes on-chain: `keccak256(abi.encode(bankCode, accountNumber, salt))`.
 *
 * The salt is what makes it safe. A 10-digit Nigerian account number is brute-forceable in
 * seconds, so an unsalted commitment would publish every recipient's bank account to the world.
 */
export function commitmentFor(recipient: Recipient): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string, string, bytes32"), [
      recipient.bankCode,
      recipient.accountNumber,
      recipient.salt,
    ]),
  );
}

export class RecipientStore {
  readonly #dir: string;
  readonly #key: Buffer;

  constructor(dir: string, keyHex: Hex) {
    this.#dir = dir;
    this.#key = Buffer.from(keyHex.slice(2), "hex");
    if (this.#key.length !== 32) throw new RelayerError("INTERNAL", "encryption key must be 32 bytes");
    mkdirSync(dir, { recursive: true });
  }

  #path(orderId: Hex): string {
    return join(this.#dir, `${orderId}.json`);
  }

  put(orderId: Hex, recipient: Recipient): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(recipient), "utf8"),
      cipher.final(),
    ]);

    writeFileSync(
      this.#path(orderId),
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        body: body.toString("base64"),
      }),
      { flush: true },
    );
  }

  get(orderId: Hex): Recipient | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.#path(orderId), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new RelayerError("INTERNAL", "could not read recipient details", { cause });
    }

    try {
      const stored = JSON.parse(raw) as { iv: string; tag: string; body: string };
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(stored.iv, "base64"));
      decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(stored.body, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plain.toString("utf8")) as Recipient;
    } catch (cause) {
      // A failed tag check means the file was altered. Treat it as missing rather than trusting it.
      throw new RelayerError("INTERNAL", "recipient details could not be decrypted", { cause });
    }
  }
}
