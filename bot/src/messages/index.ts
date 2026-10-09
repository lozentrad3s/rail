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

/**
 * When nothing understood the message. Conversational on purpose: people talk to this chat the way
 * they talk to anyone, and a wall of commands reads like being told they did it wrong.
 */
export const help = (): string =>
  [
    "I didn't quite catch that, sorry. You can talk to me normally, for example:",
    "",
    "• \"send 50k to mum\"",
    "• \"add my sister\"",
    "• \"how much do I have?\"",
    "• \"what's the rate today?\"",
    "• \"is this safe?\"",
    "",
    "Or ask me anything about how Rail works.",
  ].join("\n");

/** Today's rate, with where it came from. A number with no source is a number nobody can check. */
export const rateToday = (input: {
  localPerDollar: bigint;
  currency: string;
  live: boolean;
}): string =>
  [
    `One dollar is about ${input.localPerDollar.toLocaleString()} ${input.currency.toLowerCase() === "ngn" ? "naira" : input.currency} today.`,
    "",
    input.live
      ? "That is the market rate right now. Providers bid against it, and the best price wins."
      : "That is our last known rate. The live one is used when you actually send.",
    "",
    "Try: send 50k to mum",
  ].join("\n");

export const howToFund = (url: string): string =>
  [
    "Two ways to put money in:",
    "",
    "1. Open your account and copy your address, then send dollars to it.",
    "2. Or connect an account you already have, and nothing needs topping up at all.",
    "",
    url,
    "",
    "Either way, only you can spend it.",
  ].join("\n");

export const about = (url: string): string =>
  [
    "*Rail* sends money home.",
    "",
    "You say how much and who to. Local providers compete to deliver it, and the cheapest wins, so you keep the difference. They pay from their own bank account, so your family just receives a normal transfer.",
    "",
    "This chat can only ever suggest a payment. Approving it happens on your phone, with your face. If somebody took over this chat tomorrow they could not move a penny.",
    "",
    url,
  ].join("\n");

export const confirmRemove = (name: string): string =>
  [`Remove *${safeName(name)}*?`, "", "Reply *yes* to remove them, or *no* to keep them."].join("\n");

export const removed = (name: string): string =>
  [`${safeName(name)} is removed.`, "", "Say *contacts* to see who is left."].join("\n");

export const nothingToConfirm = (): string =>
  "There is nothing waiting for a yes or no. Say *help* to see what I can do.";

export const keptContact = (name: string): string => `Fine, ${safeName(name)} stays.`;

export const welcome = (): string =>
  [
    "Hi! I'm Rail. I send money home to Nigeria, straight from this chat.",
    "",
    "Tell me who you send to, like \"add mum\", and I'll give you a private link for their bank details. Then just say \"send 50k to mum\" whenever you need to.",
    "",
    "You can also ask me anything: how long it takes, what it costs, or how your money is protected.",
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

/*//////////////////////////////////////////////////////////////
                     QUESTIONS ABOUT RAIL
//////////////////////////////////////////////////////////////*/

/**
 * Answers to the questions people actually ask a money app before they trust it.
 *
 * Each is precise about what the mechanism does and does not promise. "Guaranteed" appears nowhere:
 * Rail changes who carries the risk, it does not make risk disappear, and a payments chat that
 * overclaims is one nobody should believe the next time it says something true.
 */
export const answers = {
  safety: (): string =>
    [
      "Good question to ask before sending anyone money. Here's how it works:",
      "",
      "• Your money waits in escrow, not with the provider and not with us, until the delivery is proven.",
      "• The provider who wins has to lock up 110% of what they bid. If they don't deliver, your money comes back and their deposit goes to you.",
      "• Only you can approve a payment, on your phone with Face ID. This chat can only suggest one.",
      "",
      "That isn't a promise nothing can ever go wrong. It means you don't have to trust a provider you've never heard of: the rules hold the money, and they keep working even if Rail itself went offline.",
    ].join("\n"),

  speed: (): string =>
    [
      "On the pilot, usually under two minutes from your approval to delivered.",
      "",
      "Providers get about 45 seconds to place sealed bids and another 45 to reveal them. The winner then pays your family's bank and the payment is confirmed.",
      "",
      "If nobody takes the transfer, your money comes straight back, usually within a minute.",
    ].join("\n"),

  cost: (): string =>
    [
      "You pay what the winning provider bids, plus a small fixed fee of about 13 cents.",
      "",
      "Before you approve, you see the most it can cost. Providers compete below that, and whatever they save you comes back to you automatically. Rail takes no cut of the exchange rate.",
      "",
      "Say \"rate\" to see today's rate.",
    ].join("\n"),

  providers: (): string =>
    [
      "Providers are businesses and individuals who hold naira and a bank account. Every transfer is a sealed auction: they bid without seeing each other's price, the lowest wins, and they pay your family from their own bank.",
      "",
      "They get paid only after the payment is proven, and they lock up a deposit first, so walking away costs them more than delivering.",
      "",
      "On the pilot today, two automated providers bid on every transfer, and their bank payouts are simulated because it's a test.",
    ].join("\n"),

  "no-provider": (): string =>
    [
      "If no provider takes a transfer, you get every cent back automatically, usually within a minute of the auction closing. There's nothing you need to do.",
      "",
      "Say \"balance\" to check what you have, or open your account to see each transfer and where it is.",
    ].join("\n"),

  "provider-fails": (): string =>
    [
      "Then their deposit covers you.",
      "",
      "Before a provider can win, they lock up 110% of what they bid. If they don't prove the payment in time, your money comes back to you, and their deposit is taken and paid to you as well.",
      "",
      "And if you're told it was paid but your family didn't receive it, you can object before the money is released.",
    ].join("\n"),

  corridors: (): string =>
    [
      "Right now Rail sends to Nigeria, from the UK and the US.",
      "",
      "Ghana, Kenya, South Africa, India, the Philippines and others are next, as providers join for those currencies. The auction doesn't care where the money lands, so a new country only needs providers who hold its currency.",
    ].join("\n"),

  recipient: (): string =>
    "No. Your family needs nothing but their normal bank account. The money arrives as an ordinary bank transfer, with a reference on it.",

  privacy: (): string =>
    [
      "Bank details never go in this chat. When you add someone, I send you a private link to enter them, and here you only ever see the last four digits, like ····4471.",
      "",
      "They're stored encrypted, and the public record holds only a sealed fingerprint of the account, never the number.",
    ].join("\n"),

  how: (): string =>
    [
      "You tell me how much and who to. I send you a link, and you approve it on your phone with Face ID.",
      "",
      "Your money then waits safely while local providers compete in a sealed auction to deliver it. The cheapest wins, pays your family's bank from their own account, and gets paid once the payment is proven. Whatever the competition saves you comes back to you.",
      "",
      "Want to try? Start with \"add mum\".",
    ].join("\n"),

  who: (): string =>
    [
      "I'm Rail's assistant. I can send money home for you, check your balance, add the people you send to, and answer questions about how Rail works.",
      "",
      "One thing I can't do is approve a payment. That only ever happens on your phone, with your face, so even someone who took over this chat couldn't move your money.",
    ].join("\n"),

  thanks: (): string => "You're welcome! Anything else? You can say something like \"send 20k to mum\" whenever you're ready.",
} as const;

/** Somebody named who, but not how much. */
export const sendNeedsAmount = (contactName: string): string =>
  `How much would you like to send to ${safeName(contactName)}? For example: "send 20k to ${safeName(contactName).toLowerCase()}".`;

/** Asked about something other than Rail. Friendly, and firmly not a general assistant. */
export const offTopic = (): string =>
  [
    "I'm only able to help with sending money through Rail, so I'll leave that one, sorry.",
    "",
    "I can send money home, check your balance, add someone new, or explain how it all works.",
  ].join("\n");
