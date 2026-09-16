import { Banknote, Gavel, Landmark, ShieldCheck } from "lucide-react";
import { site } from "@/lib/site";
import { ButtonLink, Chapter, Container, Eyebrow } from "./primitives";
import { Reveal } from "./reveal";

const STEPS = [
  { icon: ShieldCheck, title: "Stake", body: "Lock dollars as collateral. It’s what makes senders trust a stranger." },
  { icon: Gavel, title: "Bid", body: "Your bot bids on the transfers you want, at the rate you choose." },
  { icon: Landmark, title: "Pay", body: "Win, and send naira from your own bank with the transfer’s reference." },
  { icon: Banknote, title: "Earn", body: "Receive your bid in dollars once the payment is proven. Your stake unlocks." },
];

export function Providers() {
  return (
    <Chapter id="providers" tone="paper" labelledBy="providers-title" className="border-t border-line chapter-pad">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <Reveal>
          <Eyebrow tone="paper">For providers</Eyebrow>
          <h2 id="providers-title" className="mt-5 text-h2">
            Have naira? <span className="accent-serif">Earn by delivering it.</span>
          </h2>
          <p className="mt-6 max-w-[34rem] text-lead text-ink-muted">
            Licensed companies and individuals bid in the same auction, under the same rules. No brand, no balance
            sheet, no permission needed — just stake, and a bank account you already use.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href={site.pilotUrl} tone="paper" disabledLabel="Provider sign-up opens October 2026">
              Register interest
            </ButtonLink>
          </div>
        </Reveal>

        <ol className="grid gap-3 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Reveal delay={0.05 * i} className="h-full rounded-card bg-surface p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <step.icon className="size-5 text-accent" strokeWidth={2} aria-hidden="true" />
                  <span className="figure text-[0.8125rem] text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-5 text-h3">{step.title}</h3>
                <p className="mt-2 text-small text-ink-muted">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </Chapter>
  );
}
