/**
 * What this person's phone calls the thing that unlocks it.
 *
 * "Face ID" is Apple's name for it. On Android the same passkey is unlocked by a fingerprint, a
 * face, or the screen lock, through Google Password Manager, and telling an Android user to "approve
 * with Face ID" is telling them to use a feature their phone does not have. Most senders on this
 * corridor are on Android, so the default has to be the honest one.
 *
 * Read on the client only. The server has no idea what device is asking, and guessing would produce
 * the wrong word for the first paint and then change it, which is worse than being general.
 */

export type UnlockKind = "face-id" | "android" | "generic";

export function unlockKind(): UnlockKind {
  if (typeof navigator === "undefined") return "generic";
  const ua = navigator.userAgent;

  // iPadOS reports as Macintosh, so touch support is what separates a phone from a desktop.
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (apple) return "face-id";
  if (/Android/.test(ua)) return "android";
  return "generic";
}

/** Title case, for a button: "Face ID", "Fingerprint", "Your passkey". */
export function unlockName(kind: UnlockKind = unlockKind()): string {
  return { "face-id": "Face ID", android: "Fingerprint", generic: "Your passkey" }[kind];
}

/** Mid-sentence: "approve with Face ID", "approve with your fingerprint". */
export function unlockPhrase(kind: UnlockKind = unlockKind()): string {
  return {
    "face-id": "Face ID",
    android: "your fingerprint",
    generic: "your passkey",
  }[kind];
}

/** What is happening while the prompt is open. */
export function unlockWaiting(kind: UnlockKind = unlockKind()): string {
  return {
    "face-id": "Look at your phone…",
    android: "Confirm on your phone…",
    generic: "Confirm on your device…",
  }[kind];
}
