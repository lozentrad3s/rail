"use client";

import { useId, useState, type CSSProperties } from "react";
import { usd } from "@/lib/format";
import { worldBank } from "@/lib/site";
import { Chapter, Container, Eyebrow, SourceLink } from "./primitives";
import { Reveal } from "./reveal";

const MIN = 50;
const MAX = 1000;
const TARGET = 0.01; // Rail pilot target — labelled as a target wherever it appears.

export function LastMile() {
  const [amount, setAmount] = useState(200);
  const sliderId = useId();

  const lost = amount * worldBank.subSaharanAverage;
  const yearly = lost * 12;
  const fill = ((amount - MIN) / (MAX - MIN)) * 100;

  return (
    <Chapter id="last-mile" tone="paper" labelledBy="last-mile-title" className="chapter-pad">
      <Container className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:gap-20">
        <Reveal>
          <Eyebrow tone="paper">The last mile</Eyebrow>
          <h2 id="last-mile-title" className="mt-5 text-h2">
            Sending money home still costs <span className="accent-serif">too much</span>.
          </h2>
          <p className="mt-6 max-w-[34rem] text-lead text-ink-muted">
            Moving money across a border takes seconds now. Turning it into naira in a real bank account is where
            the cost hides — inside the exchange rate, where you can’t see it.
          </p>
          <p className="mt-4 max-w-[34rem] text-body text-ink-muted">
            Sub-Saharan Africa is the most expensive region in the world to send money to. Rail puts every transfer
            up for auction, so providers compete on the rate in the open.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="rounded-card bg-surface p-6 shadow-card sm:p-8">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor={sliderId} className="text-label text-ink-muted">
                You send
              </label>
              <output htmlFor={sliderId} className="figure text-[2rem] leading-none tracking-[-0.02em]">
                {usd(amount).replace(".00", "")}
              </output>
            </div>
            <input
              id={sliderId}
              type="range"
              min={MIN}
              max={MAX}
              step={10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="range mt-3"
              style={{ "--fill": `${fill}%` } as CSSProperties}
              aria-valuetext={`${usd(amount)} sent`}
            />

            <div className="mt-6 border-t border-line pt-6">
              <p className="text-small text-ink-muted">At the regional average, this never reaches your family:</p>
              <p className="mt-1 figure text-[clamp(2.5rem,1.6rem+3vw,3.75rem)] leading-none tracking-[-0.03em] text-slash-text">
                {usd(lost)}
              </p>
              <p className="mt-2 text-small text-ink-muted">
                Send that every month and you lose <span className="figure text-ink">{usd(yearly)}</span> a year.
              </p>
            </div>

            <div className="mt-7 space-y-4">
              <CostBar
                label="Average cost to sub-Saharan Africa"
                percent={worldBank.subSaharanAverage}
                amount={lost}
                tone="slash"
              />
              <CostBar
                label="Global average"
                percent={worldBank.globalAverage}
                amount={amount * worldBank.globalAverage}
                tone="muted"
              />
              <CostBar label="Rail pilot target" percent={TARGET} amount={amount * TARGET} tone="accent" isTarget />
            </div>

            <p className="mt-6">
              <SourceLink href={worldBank.source} tone="paper">
                Source: {worldBank.label}
              </SourceLink>
            </p>
          </div>
        </Reveal>
      </Container>
    </Chapter>
  );
}

function CostBar({
  label,
  percent,
  amount,
  tone,
  isTarget,
}: {
  label: string;
  percent: number;
  amount: number;
  tone: "slash" | "muted" | "accent";
  isTarget?: boolean;
}) {
  // Bars share a 0–10% scale so their lengths compare honestly.
  const width = Math.min(percent / 0.1, 1);
  const color = tone === "slash" ? "bg-slash" : tone === "accent" ? "bg-accent" : "bg-ink-muted/40";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-small">
        <span className="text-ink">
          {label}
          {isTarget && <span className="text-label ml-2 text-accent">Target</span>}
        </span>
        <span className="figure shrink-0 text-ink-muted">
          {(percent * 100).toFixed(2)}% · {usd(amount)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full origin-left rounded-full ${color}`}
          style={{ transform: `scaleX(${width})` }}
        />
      </div>
    </div>
  );
}
