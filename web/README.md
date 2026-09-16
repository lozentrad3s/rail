# Rail — web

The Rail landing site (and, from Phase C, the sender app and provider dashboard).
Next.js 16 · React 19 · Tailwind CSS 4 · Motion.

Design rules live in [`../docs/DESIGN.md`](../docs/DESIGN.md); repo rules in [`../CLAUDE.md`](../CLAUDE.md).

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (static)
npm run lint
```

## Configuration

All optional. Copy `.env.example` to `.env.local`.

| Variable | Effect when set | When unset |
|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Primary call to action opens the WhatsApp bot | Falls back to the pilot link |
| `NEXT_PUBLIC_PILOT_URL` | "Join the pilot" and "Register interest" link here | Primary CTA becomes "Try the auction"; provider sign-up shows as not yet open |
| `NEXT_PUBLIC_REPO_URL` | Shows "Read the protocol" | Button hidden |

## Structure

```
src/app/(marketing)/page.tsx     landing page — chapter order from docs/DESIGN.md §9
src/components/marketing/        one file per chapter + the interactive pieces
  chat-demo.tsx                  hero phone: chat proposes → Face ID → delivered
  auction-sim.tsx                3-second commit–reveal auction at Monad's 300ms block time
  pay-or-slash.tsx               escrow release vs collateral slash
src/lib/site.ts                  links, illustrative figures, World Bank source
src/lib/motion.ts                springs and curves (the only place they're defined)
```

Every figure on the page is labelled as illustrative, a simulation, a target, or sourced.
