"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CircleCheck, Clock, FileCheck2, ShieldAlert } from "lucide-react";
import { cn, ngn, dollarsFromCents } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { demo } from "@/lib/site";

const change = demo.limitCents - demo.winningBidCents;
const collateral = Math.floor((demo.winningBidCents * demo.collateralBps + 9_999) / 10_000);

type Outcome = "pays" | "defaults";

const MOVES: Record<Outcome, { from: string; to: string; cents: number; note: string; tone: "money" | "slash" | "neutral" }[]> = {
  pays: [
    { from: "Escrow", to: "Provider", cents: demo.winningBidCents, note: "Their bid, nothing more", tone: "neutral" },
    { from: "Escrow", to: "You", cents: change, note: "The rest of your limit", tone: "money" },
    { from: "Provider’s stake", to: "Provider", cents: collateral, note: "Released after delivery", tone: "neutral" },
  ],
  defaults: [
    { from: "Escrow", to: "You", cents: demo.limitCents, note: "Every cent back", tone: "money" },
    { from: "Provider’s stake", to: "You", cents: collateral, note: "Slashed and paid to you, not to Rail", tone: "slash" },
  ],
};

export function PayOrSlash() {
  const [outcome, setOutcome] = useState<Outcome>("pays");
  const reduce = useReducedMotion();
  const pays = outcome === "pays";

  return (
    <div className="rounded-card bg-surface p-5 shadow-card sm:p-7">
      <div role="radiogroup" aria-label="What happens if the provider" className="grid grid-cols-2 rounded-[14px] bg-paper p-1">
        {(
          [
            { value: "pays", label: "Provider pays" },
            { value: "defaults", label: "Provider doesn’t pay" },
          ] as const
        ).map((option) => {
          const checked = outcome === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setOutcome(option.value)}
              className={cn(
                "press relative h-11 rounded-[11px] text-small font-semibold transition-colors duration-150",
                checked ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {checked && (
                <motion.span
                  layoutId="outcome-pill"
                  className="absolute inset-0 rounded-[11px] bg-surface shadow-card"
                  transition={spring.settle}
                />
              )}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={outcome}
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.3, ease: ease.out }}
        >
          <div
            className={cn(
              "mt-6 flex items-start gap-3 rounded-[14px] p-4",
              pays ? "bg-money/10" : "bg-slash/10",
            )}
          >
            {pays ? (
              <FileCheck2 className="mt-0.5 size-5 shrink-0 text-money-text" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Clock className="mt-0.5 size-5 shrink-0 text-slash-text" strokeWidth={2} aria-hidden="true" />
            )}
            <div>
              <p className={cn("font-semibold", pays ? "text-money-text" : "text-slash-text")}>
                {pays ? "Payment proven" : "Deadline passes, no proof"}
              </p>
              <p className="mt-0.5 text-small text-ink-muted">
                {pays
                  ? `The bank alert matches ${ngn(demo.localAmount)} and this transfer’s reference.`
                  : "About ten minutes pass with no proof of payment. Anyone can trigger the refund, even if Rail is offline."}
              </p>
            </div>
          </div>

          <ul className="mt-4 divide-y divide-line">
            {MOVES[outcome].map((move, i) => (
              <motion.li
                key={`${outcome}-${move.from}-${move.to}`}
                initial={{ opacity: 0, x: reduce ? 0 : -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring.settle, delay: 0.06 * (i + 1) }}
                className="flex items-center justify-between gap-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-body font-medium">
                    {move.from}
                    <ArrowRight className="size-4 text-ink-muted" strokeWidth={2} aria-label="to" />
                    {move.to}
                  </p>
                  <p className="text-small text-ink-muted">{move.note}</p>
                </div>
                <p
                  className={cn(
                    "figure shrink-0 text-[1.125rem]",
                    move.tone === "money" && "text-money-text",
                    move.tone === "slash" && "text-slash-text",
                  )}
                >
                  {dollarsFromCents(move.cents)}
                </p>
              </motion.li>
            ))}
          </ul>

          <div className="mt-2 flex items-center gap-3 rounded-[14px] bg-paper p-4">
            {pays ? (
              <CircleCheck className="size-5 shrink-0 text-money" strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-5 shrink-0 text-slash" strokeWidth={2.2} aria-hidden="true" />
            )}
            <p className="text-small">
              {pays ? (
                <>
                  Your family has <span className="font-semibold">{ngn(demo.localAmount)}</span>. You paid{" "}
                  <span className="figure font-semibold">{dollarsFromCents(demo.winningBidCents)}</span>.
                </>
              ) : (
                <>
                  You receive <span className="figure font-semibold">{dollarsFromCents(demo.limitCents + collateral)}</span>:
                  your money back, plus the provider’s stake.
                </>
              )}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
