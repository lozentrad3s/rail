/**
 * Every word a person reads.
 *
 * They live here so one grep can check them all. The sender never sees the machinery — no
 * currency jargon, no addresses, no keys — partly because it would mean nothing to them, and
 * partly because WhatsApp's commerce policy forbids promoting virtual currency and a single
 * stray word is a ban risk for the number (CLAUDE.md, the ban list).
 *
 * Nothing here ever prints a full account number. The last four digits are enough for a person
 * to recognise their own recipient and useless to anyone else.
 */

export type ContactLine = {
  contactName: string;
  accountName: string;
  bankName: string;
  accountLast4: string;
};

/** Naira, grouped, no decimals — the way a receipt in Lagos prints it. */
export function naira(minorUnits: bigint): string {
  const whole = minorUnits / 100n;
  const kobo = minorUnits % 100n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return kobo === 0n ? `₦${grouped}` : `₦${grouped}.${kobo.toString().padStart(2, "0")}`;
}

/** Dollars, two decimals. Six-decimal precision is the machine's business, not the sender's. */
export function dollars(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / 1_000_000n;
  const cents = (absolute % 1_000_000n) / 10_000n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${cents.toString().padStart(2, "0")}`;
}

export const help = (): string =>
  [
    "Here is what I can do:",
    "",
    "*send 50k to mum* to send money",
    "*add mum* to add someone new",
    "*contacts* to see who you can send to",
    "*balance* to see what you have",
    "",
    "Try: send 50k to mum",
  ].join("\n");

export const welcome = (): string =>
  [
    "Hi. I am Rail, and I send money home.",
    "",
    "Start by adding someone: *add mum*",
    "Then: *send 50k to mum*",
  ].join("\n");

export const addContact = (contactName: string, url: string): string =>
  [
    `Adding ${safeName(contactName)}.`,
    "",
    "Open this to enter their account details safely:",
    url,
    "",
    "It opens once and closes in 15 minutes.",
  ].join("\n");

export const addNeedsName = (): string =>
  ["Who am I adding?", "", "Try: *add mum*"].join("\n");

/**
 * The reply when someone pastes account digits into the chat.
 *
 * It must not repeat the digits back. Meta forbids requesting financial account numbers in chat,
 * and an echoed number is the same number sitting in the chat history twice.
 */
export const accountNumberInChat = (): string =>
  [
    "Please do not put account numbers in this chat. It is not a safe place for them.",
    "",
    "Tell me who they are instead, like *add mum*, and I will send you a private place to enter the details.",
  ].join("\n");

/** More than this and the reply stops being readable long before WhatsApp stops accepting it. */
const LIST_LIMIT = 15;

export const contactList = (contacts: ContactLine[]): string => {
  const shown = contacts.slice(0, LIST_LIMIT);
  const hidden = contacts.length - shown.length;

  return [
    "You can send to:",
    "",
    ...shown.map(
      (contact, index) =>
        `${index + 1}. *${safeName(contact.contactName)}* (${safeName(contact.accountName)}, ${safeName(contact.bankName)} ····${contact.accountLast4})`,
    ),
    ...(hidden > 0 ? ["", `…and ${hidden} more.`] : []),
    "",
    "Try: send 50k to mum",
  ].join("\n");
};

export const noContacts = (): string =>
  ["You have not added anyone yet.", "", "Start with: *add mum*"].join("\n");

/**
 * A name is whatever someone typed, and it comes straight back out.
 *
 * So it is trimmed first: asterisks and underscores are WhatsApp's own formatting, and a name of
 * unbounded length turns a short reply into a wall of someone else's text.
 */
export function safeName(raw: string): string {
  let cleaned = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    // Control characters, zero-width marks and bidi overrides: invisible, and used to disguise text.
    if (code < 0x20 || code === 0x7f) continue;
    if (code >= 0x200b && code <= 0x200f) continue;
    if (code >= 0x202a && code <= 0x202e) continue;
    // WhatsApp reads these as formatting, so a name could italicise the rest of the message.
    if ("*_~`".includes(char)) continue;
    cleaned += char;
  }

  const trimmed = cleaned.trim();
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed;
}

export const unknownContact = (contactName: string): string => {
  const name = safeName(contactName);
  return [
    `I do not have anyone called "${name}".`,
    "",
    `Say *add ${name}* to add them, or *contacts* to see who you have.`,
  ].join("\n");
};

export const unreadableAmount = (): string =>
  ["I could not read that amount.", "", "Try: *send 50k to mum* or *send 50,000 to mum*"].join("\n");

export const amountTooSmall = (): string => "That is too small to send. Try at least ₦100.";

export const confirmSend = (input: {
  localAmount: bigint;
  contact: ContactLine;
  indicativeUnits: bigint;
  url: string;
}): string =>
  [
    `Send ${naira(input.localAmount)} to *${safeName(input.contact.contactName)}*`,
    `${safeName(input.contact.accountName)} · ${safeName(input.contact.bankName)} ····${input.contact.accountLast4}`,
    "",
    `About ${dollars(input.indicativeUnits)} today. You will see the exact amount before you approve.`,
    "",
    "Approve with Face ID:",
    input.url,
    "",
    "Nothing leaves your account until you approve.",
  ].join("\n");

export const balance = (units: bigint): string =>
  [`You have ${dollars(units)}.`, "", "Try: send 50k to mum"].join("\n");

export const linkAccount = (url: string): string =>
  [
    "Let us connect your account first. One tap with Face ID:",
    url,
    "",
    "Then come back and say *balance*.",
  ].join("\n");

export const somethingWentWrong = (): string =>
  "Something went wrong on my side. Nothing was sent. Please try again in a moment.";
