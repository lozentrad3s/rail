import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { verifyChallenge, verifySignature } from "../src/signature.ts";

const SECRET = "app-secret";
const BODY = Buffer.from('{"entry":[{"changes":[]}]}');
const sign = (body: Buffer, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("webhook signatures", () => {
  it("accepts what Meta signed", () => {
    assert.equal(verifySignature(BODY, sign(BODY), SECRET), true);
  });
});

describe("webhook signature attacks", () => {
  // Anyone can POST to a public webhook. Without the signature it is an open payments interface.
  it("rejects an unsigned body", () => {
    assert.equal(verifySignature(BODY, undefined, SECRET), false);
    assert.equal(verifySignature(BODY, "", SECRET), false);
  });

  // A body altered in flight must not verify — this is the whole point of signing the raw bytes.
  it("rejects a body changed after signing", () => {
    const header = sign(BODY);
    const tampered = Buffer.from('{"entry":[{"changes":[1]}]}');
    assert.equal(verifySignature(tampered, header, SECRET), false);
  });

  it("rejects a signature made with the wrong secret", () => {
    assert.equal(verifySignature(BODY, sign(BODY, "not-the-secret"), SECRET), false);
  });

  // An attacker who picks the algorithm picks a weak one.
  it("rejects a header that names another algorithm", () => {
    const digest = createHmac("sha256", SECRET).update(BODY).digest("hex");
    assert.equal(verifySignature(BODY, `sha1=${digest}`, SECRET), false);
    assert.equal(verifySignature(BODY, digest, SECRET), false);
  });

  it("rejects a truncated signature rather than throwing on the length", () => {
    const header = sign(BODY).slice(0, 20);
    assert.equal(verifySignature(BODY, header, SECRET), false);
  });

  it("rejects non-hex rather than throwing", () => {
    assert.equal(verifySignature(BODY, "sha256=zzzz", SECRET), false);
  });

  // With no secret configured, everything must fail closed.
  it("verifies nothing when the secret is missing", () => {
    assert.equal(verifySignature(BODY, sign(BODY, ""), ""), false);
  });
});

describe("Meta's verification handshake", () => {
  const query = (token: string) =>
    new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" });

  it("echoes the challenge for our own token", () => {
    assert.equal(verifyChallenge(query("ours"), "ours"), "1158201444");
  });

  it("stays silent for anyone else's", () => {
    assert.equal(verifyChallenge(query("theirs"), "ours"), undefined);
    assert.equal(verifyChallenge(query("ours"), ""), undefined);
  });

  it("ignores a handshake that is not a subscribe", () => {
    const q = query("ours");
    q.set("hub.mode", "unsubscribe");
    assert.equal(verifyChallenge(q, "ours"), undefined);
  });
});
