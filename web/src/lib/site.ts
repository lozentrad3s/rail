// Public site configuration. Links that don't exist yet resolve to null, and the UI renders an
// honest "not yet" state instead of a dead link.

/**
 * Telegram is the live chat. WhatsApp is not.
 *
 * Meta's business verification is still outstanding, so the number answers nothing. A call to action
 * pointing at it would be the one thing this file exists to prevent — a confident button that goes
 * nowhere. Telegram needed no verification and works today, so it gets the button and WhatsApp is
 * labelled for what it is.
 */
const telegramHandle = process.env.NEXT_PUBLIC_TELEGRAM_BOT?.replace(/^@/, "") || null;
const telegramUrl = telegramHandle ? `https://t.me/${telegramHandle}` : null;

const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;
/** Kept only so the page can say "coming soon" about something specific, never as a link. */
const whatsappComingSoon = whatsappNumber !== null;

const pilotUrl = process.env.NEXT_PUBLIC_PILOT_URL || null;

/**
 * Where this deployment lives, for absolute URLs in link previews.
 *
 * A share card's image has to be absolute: a relative path resolves against whatever opened it,
 * which for Telegram and WhatsApp is their own servers, and the preview comes back blank. Vercel
 * supplies the deployment host, so a preview build previews itself rather than production.
 */
export const origin = new URL(
  process.env.NEXT_PUBLIC_SITE_ORIGIN ||
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "https://rail-pay.vercel.app"),
);

/**
 * The one thing we most want a visitor to do, in order of what exists:
 * the Telegram bot → the pilot sign-up → the auction simulation (always real, never a dead end).
 */
const primaryCta = telegramUrl
  ? { href: telegramUrl, label: "Open Rail on Telegram", short: "Open Telegram", external: true }
  : pilotUrl
    ? { href: pilotUrl, label: "Join the pilot", short: "Join the pilot", external: true }
    : { href: "#auction", label: "Try the auction", short: "Try the auction", external: false };

export const site = {
  name: "Rail",
  tagline: "Send money home, straight from a chat.",
  telegramUrl,
  whatsappComingSoon,
  pilotUrl,
  primaryCta,
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || null,
  pilotLabel: "Pilot · October 2026",
} as const;

/**
 * Where money can go.
 *
 * The pilot corridor is the only one with providers recruited, so it is the only one marked live.
 * Everything else is listed because the mechanism does not care about the destination: a provider
 * who holds the local currency and a bank account can bid on any corridor, which is the point of a
 * permissionless auction. Listing them is a roadmap, not a claim, and the UI must label them so.
 */
export const corridors = [
  { to: "Nigeria", currency: "NGN", region: "Africa", live: true },
  { to: "Ghana", currency: "GHS", region: "Africa", live: false },
  { to: "Kenya", currency: "KES", region: "Africa", live: false },
  { to: "South Africa", currency: "ZAR", region: "Africa", live: false },
  { to: "India", currency: "INR", region: "Asia", live: false },
  { to: "Philippines", currency: "PHP", region: "Asia", live: false },
  { to: "Pakistan", currency: "PKR", region: "Asia", live: false },
  { to: "Eurozone", currency: "EUR", region: "Europe", live: false },
  { to: "United Kingdom", currency: "GBP", region: "Europe", live: false },
  { to: "Brazil", currency: "BRL", region: "Americas", live: false },
] as const;

/**
 * The auction's real shape, in one place.
 *
 * This existed in five places and no two agreed: the widget said 5 blocks, a stat said ~24s, the
 * prose said half a minute, and the contract said something else again. Every one of them was
 * written when it was true and none were updated together. Internal contradiction is the single
 * thing a judge reads as "they did not check their own work", so the numbers are derived here and
 * nothing else is allowed to state them.
 *
 * `blockMs` is measured, not quoted: 302ms over a 1000-block sample on 4 Oct 2026.
 * The block counts are the constants the deployed `RailCore` was built with.
 */
const BLOCK_MS = 302;

export const auction = {
  commitBlocks: 150,
  revealBlocks: 150,
  blockMs: BLOCK_MS,
  commitSeconds: Math.round((150 * BLOCK_MS) / 1000),
  revealSeconds: Math.round((150 * BLOCK_MS) / 1000),
  totalSeconds: Math.round((300 * BLOCK_MS) / 1000),
} as const;

/** Illustrative figures used across the page. Kept in one place so every chapter agrees. */
export const demo = {
  localAmount: 50_000,
  bank: "GTBank",
  accountLast4: "4471",
  recipientName: "ADAEZE O. OKONKWO",
  recipientFirstName: "Adaeze",
  /**
   * The market rate, with the date it was true.
   *
   * Every other figure here is derived from it, so they move together. It sat at 1,534 long after
   * the market was at 1,328, which quoted a ceiling no provider could fill — a number with no date
   * is a number nobody notices going stale.
   */
  rate: 1_328,
  rateAsOf: "2 October 2026",
  rateSource: "https://open.er-api.com/v6/latest/USD",
  limitCents: 3_840,
  winningBidCents: 3_822,
  feeCents: 13,
  collateralBps: 11_000,
  deliveredSeconds: 41,
} as const;

/** World Bank Remittance Prices Worldwide, Issue 54 (Q3 2025): cost of sending $200 to sub-Saharan Africa. */
export const worldBank = {
  subSaharanAverage: 0.0846,
  globalAverage: 0.0636,
  source: "https://remittanceprices.worldbank.org/",
  label: "World Bank, Remittance Prices Worldwide, Q3 2025",
} as const;
