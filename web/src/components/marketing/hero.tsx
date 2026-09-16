import { Fingerprint, Landmark, ShieldCheck } from "lucide-react";
import { site } from "@/lib/site";
import { ChatDemo } from "./chat-demo";
import { ButtonLink, Chapter, Container, Eyebrow } from "./primitives";

// Sender register: this chapter obeys the sender ban list in CLAUDE.md.
export function Hero() {
  return (
    <Chapter id="top" tone="night" labelledBy="hero-title" className="overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_72%_42%,rgb(110_84_255/0.30),transparent_70%),radial-gradient(40%_35%_at_15%_85%,rgb(133_230_255/0.08),transparent_70%)]"
      />
      <Container className="grid items-center gap-14 pb-20 pt-28 sm:pt-32 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:pb-24 lg:pt-36">
        <div className="max-w-[42rem]">
          <Eyebrow tone="night">
            <span className="size-1.5 rounded-full bg-signal" />
            {site.pilotLabel} · UK &amp; US → Nigeria
          </Eyebrow>

          <h1 id="hero-title" className="mt-6 text-hero">
            Send money <span className="accent-serif text-accent-soft">home</span>,
            <br className="hidden sm:block" /> straight from WhatsApp.
          </h1>

          <p className="mt-6 max-w-[34rem] text-lead text-night-muted">
            Type an amount in the chat and confirm with Face ID. Your family’s bank account receives naira.
            Local providers compete to deliver every transfer — and the saving comes back to you.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href={site.primaryCta.href} tone="night" external={site.primaryCta.external}>
              {site.primaryCta.label}
            </ButtonLink>
            <ButtonLink href="#how-it-works" tone="night" variant="secondary">
              See how it works
            </ButtonLink>
          </div>

          <ul className="mt-12 grid gap-3 text-small text-night-muted">
            <li className="flex items-start gap-2.5">
              <Fingerprint className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2} aria-hidden="true" />
              Approve with Face ID. No passwords to steal.
            </li>
            <li className="flex items-start gap-2.5">
              <Landmark className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2} aria-hidden="true" />
              Your family needs only a normal bank account.
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2} aria-hidden="true" />
              Rail never holds your family’s money.
            </li>
          </ul>
        </div>

        <div className="flex justify-center lg:justify-end">
          <ChatDemo />
        </div>
      </Container>
    </Chapter>
  );
}
