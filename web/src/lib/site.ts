// Public site configuration. Links that don't exist yet resolve to null, and the UI renders an
// honest "not yet" state instead of a dead link.

const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;
const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent("hi")}` : null;
const pilotUrl = process.env.NEXT_PUBLIC_PILOT_URL || null;

/**
 * The one thing we most want a visitor to do, in order of what exists:
 * the WhatsApp bot → the pilot sign-up → the auction simulation (always real, never a dead end).
 */
const primaryCta = whatsappUrl
  ? { href: whatsappUrl, label: "Continue on WhatsApp", short: "Open WhatsApp", external: true }
  : pilotUrl
    ? { href: pilotUrl, label: "Join the pilot", short: "Join the pilot", external: true }
    : { href: "#auction", label: "Try the auction", short: "Try the auction", external: false };

export const site = {
  name: "Rail",
  tagline: "Send money home, straight from WhatsApp.",
  whatsappUrl,
  pilotUrl,
  primaryCta,
  repoUrl: process.env.NEXT_PUBLIC_REPO_URL || null,
  pilotLabel: "Pilot · October 2026",
} as const;

/** Illustrative figures used across the page. Kept in one place so every chapter agrees. */
export const demo = {
  localAmount: 50_000,
  bank: "GTBank",
  accountLast4: "4471",
  recipientName: "ADAEZE O. OKONKWO",
  recipientFirstName: "Adaeze",
  rate: 1_534,
  limitCents: 3_360,
  winningBidCents: 3_261,
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
