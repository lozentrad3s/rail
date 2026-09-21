/**
 * A webhook is hostile until the signature verifies.
 *
 * Meta signs the raw request body with the app secret. The check has to run over the exact bytes
 * received — parse first and re-serialise and the signature will not match, which is the point.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * True only for a body Meta signed.
 *
 * The comparison is constant time: a byte-by-byte early return leaks the expected digest to
 * anyone willing to time a few thousand requests.
 */
export function verifySignature(body: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;

  const [algorithm, presented] = header.split("=");
  if (algorithm !== "sha256" || !presented) return false;

  const expected = createHmac("sha256", appSecret).update(body).digest();

  let presentedBytes: Buffer;
  try {
    presentedBytes = Buffer.from(presented, "hex");
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch, which would itself be a length oracle.
  if (presentedBytes.length !== expected.length) return false;
  return timingSafeEqual(presentedBytes, expected);
}

/** Meta's GET handshake: echo the challenge only when the token it presents is ours. */
export function verifyChallenge(
  query: URLSearchParams,
  verifyToken: string,
): string | undefined {
  const presented = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge") ?? "";
  if (query.get("hub.mode") !== "subscribe" || !challenge) return undefined;

  const a = Buffer.from(presented);
  const b = Buffer.from(verifyToken);
  if (!verifyToken || a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

  return challenge;
}
