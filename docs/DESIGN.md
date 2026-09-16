# Rail — Design System

Governs every pixel in `web/`. Built from Apple's fluid-interface principles, Emil Kowalski's
design-engineering rules, and Monad's brand kit — so Rail reads as native to the Monad ecosystem
without borrowing Monad's identity.

**The feeling we're designing for: calm confidence.** Sending money home is emotional and
high-stakes. Nothing should feel like a crypto app, a casino, or a demo. It should feel like the
most trustworthy bank you've used — that happens to be faster than all of them.

---

## 1 · Principles

1. **Purpose over decoration.** Every animation explains a mechanism (the auction, the escrow, the
   proof) or confirms an action. If it does neither, cut it.
2. **Show, don't claim.** We never say "instant" or "secure" — we show a block counter ticking at
   300ms and collateral locking in front of the reader.
3. **Honest by construction.** Simulations are labelled as simulations. Targets are labelled as
   targets. Nothing implies a partner, licence or number we don't have.
4. **Two audiences, two registers.** Above the fold speaks to a sender: naira, dollars, Face ID,
   WhatsApp. Lower sections speak to judges and builders: commit–reveal, collateral, Monad. The hero
   obeys the sender ban list (`CLAUDE.md`).
5. **Interruptible everywhere.** Every interactive animation can be replayed, paused or restarted
   mid-flight without a jump.

---

## 2 · Color

Art-directed chapters, not a theme toggle: the page alternates **Night** (Monad's dark) and **Paper**
(warm off-white) so each chapter of the story has its own light.

### Tokens

| Token | Value | Use |
|---|---|---|
| `--night` | `#0E091C` | Night chapter background (Monad dark) |
| `--night-raised` | `#18122B` | Cards on night |
| `--night-line` | `rgb(255 255 255 / 0.08)` | Hairlines on night |
| `--night-text` | `#F4F2FA` | Primary text on night |
| `--night-muted` | `#A7A1BD` | Secondary text on night (7.6:1) |
| `--paper` | `#FAF9F6` | Paper chapter background |
| `--surface` | `#FFFFFF` | Cards on paper |
| `--line` | `rgb(14 9 28 / 0.08)` | Hairlines on paper |
| `--ink` | `#0E091C` | Primary text on paper |
| `--ink-muted` | `#57516A` | Secondary text on paper (7.4:1) |
| `--accent` | `#6E54FF` | Monad purple — primary actions, the winning bid, links (white text 4.8:1) |
| `--accent-soft` | `#DDD7FE` | Accent tints, selected states |
| `--signal` | `#85E6FF` | Monad cyan — the block ticker, live indicators (night only) |
| `--money` | `#12B76A` | Money arrived — fills and dots only |
| `--money-text` | `#067647` | Money arrived — text on paper (5.8:1) |
| `--slash` | `#F04438` | Collateral slashed — fills only |
| `--slash-text` | `#B42318` | Slash — text on paper (6.4:1) |

**Rules**
- Purple is a **verb**: it marks what's acting (the button you press, the bid that's winning).
  Never a background wash.
- Green means **money arrived**. Nothing else is green.
- Red means **stake slashed**. Nothing else is red — errors in forms use `--slash-text` with an icon.
- Color never carries meaning alone: every state also has an icon or a label.

---

## 3 · Typography

| Role | Family | Why |
|---|---|---|
| Display + UI | **Inter** (variable, `opsz` axis) | Monad's body face; optical sizing lets one family carry 88px headlines and 13px labels |
| Emotional accent | **Instrument Serif** italic | One or two words per headline ("home", "competes"). Warmth against a precise sans |
| Numbers, blocks, labels | **Roboto Mono** | Monad's label face. Tabular figures for amounts and block heights that tick |

Size-specific tracking and leading — never one value for all sizes:

| Style | Size | Leading | Tracking | Weight |
|---|---|---|---|---|
| `display` | `clamp(2.75rem, 1.2rem + 5.2vw, 5.5rem)` | 0.98 | −0.035em | 600 |
| `h2` | `clamp(2rem, 1.1rem + 3vw, 3.5rem)` | 1.04 | −0.028em | 600 |
| `h3` | `1.5rem` | 1.2 | −0.015em | 600 |
| `lead` | `clamp(1.125rem, 1rem + 0.5vw, 1.3125rem)` | 1.5 | −0.005em | 400 |
| `body` | `1.0625rem` | 1.6 | 0 | 400 |
| `small` | `0.875rem` | 1.5 | 0.005em | 400 |
| `label` | `0.75rem` mono, uppercase | 1.3 | 0.08em | 500 |
| `figure` | mono, `tabular-nums` | 1 | −0.01em | 500 |

Serif accents render ~8% larger than the surrounding sans to match x-height.

---

## 4 · Space, radius, depth

- **Spacing** (spacious marketing scale, rem): `0.25 · 0.5 · 0.75 · 1 · 1.5 · 2 · 3 · 4 · 6 · 8 · 12`.
  Chapter padding: `clamp(5rem, 12vw, 10rem)` vertical. Side gutter: `clamp(1rem, 4vw, 2.5rem)`.
- **Max widths:** text column `38rem`, content `72rem`.
- **Radius:** `8px` chips · `14px` controls · `22px` cards · `44px` phone frame.
- **Shadows** (paper): `0 1px 2px rgb(14 9 28 / .06), 0 8px 24px -8px rgb(14 9 28 / .12)`.
  Bigger surfaces cast deeper shadows. Night cards use a 1px inner top highlight instead of a shadow.

## 5 · Materials

- **Navigation** is a floating glass layer, not an opaque bar:
  `background: rgb(250 249 246 / .72); backdrop-filter: blur(20px) saturate(180%)` on paper,
  `rgb(14 9 28 / .6)` on night. The bar swaps material as chapters scroll under it.
- **Never stack light glass on light glass.**
- `prefers-reduced-transparency: reduce` → solid backgrounds, no blur.
- `prefers-contrast: more` → solid backgrounds and a visible 1px border on every surface.

---

## 6 · Motion

### Curves and springs

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);    /* entering, responding */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* sheets (Face ID sheet) */
```

| Spring | Motion config | Use |
|---|---|---|
| `settle` | `{ type: "spring", bounce: 0, duration: 0.4 }` | Default for everything |
| `sheet` | `{ type: "spring", bounce: 0.15, duration: 0.45 }` | The Face ID sheet |
| `flick` | `{ type: "spring", bounce: 0.2, duration: 0.4 }` | Only after a user flick/drag |

### Durations

| Thing | Duration |
|---|---|
| Press feedback (`scale(0.97)`) | 120ms `--ease-out` |
| Hover color | 160ms `ease` (gated behind `(hover: hover) and (pointer: fine)`) |
| Chat bubble in | `settle` spring, 60ms stagger |
| Chapter reveal on scroll | 600ms `--ease-out`, 8px rise + opacity, once |
| Block tick | 300ms — **the real Monad block time**, not a design choice |

### Rules
- Never animate from `scale(0)`; start at `scale(0.96)` + `opacity: 0`.
- Only `transform`, `opacity`, `filter`, `clip-path`.
- Exits are faster than entrances.
- Autoplaying sequences (hero chat, auction) **pause when offscreen** and **replay on demand**.
- `prefers-reduced-motion: reduce` → no movement; content cross-fades and sequences render their
  final state with a "Play" button.

---

## 7 · Components

| Component | Spec |
|---|---|
| **Button / primary** | `--accent` fill, white label, 14px radius, 48px min height, `scale(0.97)` on `:active` |
| **Button / secondary** | 1px `--line` border on paper, `--night-line` on night; same press behaviour |
| **Chip / label** | Mono uppercase `label` style, 8px radius |
| **Phone frame** | 44px radius, 10px bezel on night, inner status bar; content is real DOM (not an image) |
| **Chat bubble** | Outgoing: `--accent-soft` on paper phone. Incoming: surface. 18px radius with a 6px tail corner |
| **Face ID sheet** | Slides from the bottom of the phone frame with `sheet`; dims the chat behind it |
| **Bid card** | Sealed: lock icon + truncated commitment hash. Revealed: flips (rotateY, `settle`) to amount. Winner: accent ring + collateral bar |
| **Block ticker** | Mono `figure`, `--signal`, increments every 300ms, tabular so width never shifts |
| **Stat** | `figure` value + `small` caption + source link |

Touch targets ≥ 44×44px. Visible focus ring: 2px `--accent`, 2px offset, on every interactive element.

---

## 8 · Voice

- **Plain, warm, specific.** "Your mum's bank gets ₦50,000." not "Recipient receives funds."
- **Numbers carry the argument.** Always with a source or a "target"/"simulation" label.
- **Kill list:** revolutionary, game-changing, seamless, next-gen, web3, unlock, empower, "the future of".
- **Sender register (hero, calls to action):** no crypto vocabulary — see the ban list in `CLAUDE.md`.
- **Builder register (how-it-works, Monad chapter):** precise terms welcome — commit–reveal,
  collateral, EIP-3009, AUSD, Monad.

## 9 · Landing page structure

| # | Chapter | Light | Job | Signature interaction |
|---|---|---|---|---|
| 0 | Nav | glass | Wayfinding | Material swaps between paper and night |
| 1 | **Hero** | night | A sender understands the product in 5 seconds | Phone plays "send 50k to mum" → quote → Face ID → delivered |
| 2 | **The last mile** | paper | The problem, in money | Amount slider: what 8.46% costs you (World Bank) |
| 3 | **How it works** | paper | Six steps from chat to bank alert | Scroll-linked progress rail |
| 4 | **The auction** | night | The thesis, for judges | Run a 3-second sealed-bid auction at real Monad block cadence |
| 5 | **Never custody** | paper | Safety | Toggle "provider pays / provider doesn't" → release vs slash |
| 6 | **Why Monad** | night | Monad necessity | Block time, finality, fees — with the one-line argument |
| 7 | **Providers** | paper | Supply side | Earn by delivering naira |
| 8 | **Close** | night | Action | Continue on WhatsApp · Read the protocol |

## 10 · Accessibility and performance budgets

- WCAG 2.2 AA contrast on every text token (ratios above).
- All sequences keyboard-operable; live regions announce auction results politely.
- Semantic landmarks; one `h1`; headings in order.
- LCP < 2.0s on 4G mobile; CLS < 0.05; no layout shift from fonts (`next/font`).
- Test widths: 360, 390, 768, 1024, 1440.
