"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll } from "motion/react";
import { Chapter, Container, Eyebrow } from "./primitives";
import { Reveal } from "./reveal";

const STEPS = [
  {
    title: "You confirm with Face ID",
    body: "One approval on your phone. No password, no app to install, nothing to top up first.",
    detail: "Passkey signs one EIP-3009 authorisation",
  },
  {
    title: "Your dollars wait in escrow",
    body: "They sit in an open contract — not with us — until your family is paid.",
    detail: "RailCore escrow · AUSD",
  },
  {
    title: "Providers bid for three seconds",
    body: "Sealed bids first, so nobody can copy a price. Then they reveal. The lowest wins.",
    detail: "Commit–reveal · 5 + 5 blocks",
  },
  {
    title: "The winner pays your family",
    body: "Bank to bank, from the provider’s own account, with a reference only this transfer uses.",
    detail: "Rail never touches naira",
  },
  {
    title: "The payment is proven",
    body: "By the bank’s credit alert, a one-tap confirmation from your family, or a quiet dispute window.",
    detail: "L0 dispute window · L1 confirm · L2 bank alert",
  },
  {
    title: "Everyone settles",
    body: "The provider receives exactly their bid. Whatever’s left of the price you set comes back to you.",
    detail: "Change → sender · collateral released",
  },
];

export function HowItWorks() {
  const listRef = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 75%", "end 55%"] });

  return (
    <Chapter id="how-it-works" tone="paper" labelledBy="how-title" className="border-t border-line chapter-pad">
      <Container className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
            <Eyebrow tone="paper">How it works</Eyebrow>
            <h2 id="how-title" className="mt-5 text-h2">
              From a chat message to a bank alert in <span className="accent-serif">six steps</span>.
            </h2>
            <p className="mt-6 max-w-[30rem] text-lead text-ink-muted">
              You see the first step and the last. Everything in between is an open protocol that anyone can check —
              and nobody, including us, can quietly change.
            </p>
          </Reveal>
        </div>

        <ol ref={listRef} className="relative">
          {/* The rail: fills as you read down the steps */}
          <span aria-hidden="true" className="absolute bottom-4 left-[19px] top-4 w-0.5 rounded-full bg-line" />
          <motion.span
            aria-hidden="true"
            className="absolute bottom-4 left-[19px] top-4 w-0.5 origin-top rounded-full bg-accent"
            style={{ scaleY: reduce ? 1 : scrollYProgress }}
          />

          {STEPS.map((step, i) => (
            <li key={step.title} className="relative grid grid-cols-[40px_1fr] gap-5 pb-10 last:pb-0">
              <span className="figure relative grid size-10 place-items-center rounded-full bg-surface text-[0.875rem] text-accent shadow-[inset_0_0_0_1.5px_var(--color-accent-soft),var(--shadow-card)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Reveal className="pt-1.5">
                <h3 className="text-h3">{step.title}</h3>
                <p className="mt-2 max-w-[34rem] text-body text-ink-muted">{step.body}</p>
                <p className="text-label mt-3 text-ink-muted/80">{step.detail}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </Chapter>
  );
}
