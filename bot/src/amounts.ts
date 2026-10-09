/**
 * Reading an amount the way a person writes one.
 *
 * "50k", "50,000", "₦50000", "50 000" all mean the same thing to a sender and must mean the same
 * thing here. Everything is integer arithmetic in minor units (kobo): a float here is somebody's
 * money rounded away.
 */

/** Naira are quoted in kobo on the wire, as `docs/INTERFACES.md` requires. */
const MINOR_PER_UNIT = 100n;

/** Below this, the fee is worth more than the transfer. */
export const MINIMUM_MINOR = 10_000n;

const MULTIPLIERS: Record<string, bigint> = { k: 1_000n, m: 1_000_000n };

/**
 * Returns the amount in minor units, or undefined when the text is not an amount.
 *
 * Undefined means "ask again", never "assume zero".
 */
export function parseAmount(raw: string): bigint | undefined {
  const cleaned = raw
    .trim()
    .toLowerCase()
    // Longest alternative first, or "ngn50000" loses only its "n" and stops parsing.
    .replace(/^(?:₦|ngn|naira|n)\s*/, "")
    .replace(/\s*(?:naira|ngn)$/, "")
    // "20 thousand", "2 million": how people say it out loud, and so how they type it in a chat.
    .replace(/\s*(?:thousand|grand)$/, "k")
    .replace(/\s*(?:million|mil)$/, "m")
    // Separators people type: commas, spaces, narrow spaces.
    .replace(/[,\s  ]/g, "");

  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(cleaned);
  if (!match) return undefined;

  const [, digits = "", suffix] = match;
  const multiplier = suffix ? MULTIPLIERS[suffix] : undefined;
  if (suffix && multiplier === undefined) return undefined;

  const [whole = "0", fraction = ""] = digits.split(".");

  // "2.5k" is 2,500 — so the fraction scales by the multiplier too. Done in integers by padding
  // the fraction out to the width of the multiplier and truncating anything below one kobo.
  const scale = multiplier ?? 1n;
  const scaleDigits = scale.toString().length - 1;
  const totalDigits = scaleDigits + 2; // plus the two digits of kobo
  if (fraction.length > totalDigits) {
    // More precision than a kobo: not an amount anyone meant to type.
    if (/[1-9]/.test(fraction.slice(totalDigits))) return undefined;
  }

  const padded = (fraction + "0".repeat(totalDigits)).slice(0, totalDigits);
  const minor = BigInt(whole) * scale * MINOR_PER_UNIT + BigInt(padded || "0");
  return minor;
}
