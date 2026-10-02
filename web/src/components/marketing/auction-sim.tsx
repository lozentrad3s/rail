"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Lock, Play, RotateCcw, TriangleAlert, Trophy } from "lucide-react";
import { cn, ngn, dollarsFromCents } from "@/lib/format";
import { BLOCK_MS, ease, spring } from "@/lib/motion";
import { demo } from "@/lib/site";

/**
 * A faithful simulation of RailCore's auction (docs/INTERFACES.md §2, §4.3):
 * commit for 5 blocks, reveal for 5 blocks, award after. A revealed bid leads only if it is strictly
 * lower than the current leader AND its provider has free stake ≥ ceil(bid × collateralBps / 10000).
 * Everything rendered is derived from (scenario, tick), so restarting mid-run can never desync.
 */

type BidderId = "licensed" | "abuja" | "portharcourt";

const BIDDERS: Record<BidderId, { name: string; place: string; freeStakeCents: number }> = {
  licensed: { name: "Licensed remittance company", place: "London", freeStakeCents: 25_000_000 },
  abuja: { name: "Individual provider", place: "Abuja", freeStakeCents: 150_000 },
  portharcourt: { name: "New provider", place: "Port Harcourt", freeStakeCents: 3_000 },
};

type Bid = { bidder: BidderId; cents: number; commitAt: number; revealAt: number };

// Ordered as they appear on screen. Reveal order comes from revealAt.
const SCENARIOS: Bid[][] = [
  [
    { bidder: "licensed", cents: 3_288, commitAt: 1, revealAt: 6 },
    { bidder: "abuja", cents: 3_261, commitAt: 3, revealAt: 8 },
    { bidder: "portharcourt", cents: 3_297, commitAt: 4, revealAt: 9 },
  ],
  [
    { bidder: "licensed", cents: 3_252, commitAt: 2, revealAt: 7 },
    { bidder: "abuja", cents: 3_270, commitAt: 1, revealAt: 6 },
    { bidder: "portharcourt", cents: 3_290, commitAt: 5, revealAt: 10 },
  ],
  [
    { bidder: "licensed", cents: 3_280, commitAt: 1, revealAt: 6 },
    { bidder: "abuja", cents: 3_266, commitAt: 2, revealAt: 7 },
    { bidder: "portharcourt", cents: 3_231, commitAt: 4, revealAt: 9 },
  ],
];

const COMMIT_END = 5;
const REVEAL_END = 10;
const AWARD_TICK = REVEAL_END + 1;
const BASE_BLOCK = 19_482_300;

type Phase = "ready" | "commit" | "reveal" | "awarded";
type Status = "waiting" | "sealed" | "leading" | "outbid" | "skipped" | "won" | "lost";

const collateralFor = (cents: number) => Math.floor((cents * demo.collateralBps + 9_999) / 10_000);

function phaseAt(tick: number): Phase {
  if (tick === 0) return "ready";
  if (tick <= COMMIT_END) return "commit";
  if (tick <= REVEAL_END) return "reveal";
  return "awarded";
}

function resolve(bids: Bid[], tick: number) {
  let leader: Bid | null = null;
  const skipped = new Set<BidderId>();
  for (const bid of [...bids].sort((a, b) => a.revealAt - b.revealAt)) {
    if (tick < bid.revealAt) continue;
    if (bid.cents > demo.limitCents) continue;
    if (leader && bid.cents >= leader.cents) continue;
    if (BIDDERS[bid.bidder].freeStakeCents < collateralFor(bid.cents)) {
      skipped.add(bid.bidder);
      continue;
    }
    leader = bid;
  }
  return { leader, skipped };
}

function statusOf(bid: Bid, tick: number, leader: Bid | null, skipped: Set<BidderId>): Status {
  if (tick < bid.commitAt) return "waiting";
  if (tick < bid.revealAt) return "sealed";
  if (skipped.has(bid.bidder)) return "skipped";
  const awarded = tick >= AWARD_TICK;
  if (leader?.bidder === bid.bidder) return awarded ? "won" : "leading";
  return awarded ? "lost" : "outbid";
}

/** Deterministic pseudo-hash so server and client render the same commitment. */
function commitment(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0x5bd1e995);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `0x${hex(h1).slice(0, 4)}…${hex(h2).slice(4)}`;
}

const wholeUsd = (cents: number) => dollarsFromCents(cents).replace(/\.00$/, "");

export function AuctionSim() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.3 });
  const reduce = useReducedMotion();
  const autoPlayed = useRef(false);

  const [scenario, setScenario] = useState(0);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [slow, setSlow] = useState(false);
  const [runCount, setRunCount] = useState(0);

  const active = running && tick < AWARD_TICK;

  // Ticks at Monad's real block time (or 3× slower). Pauses while offscreen.
  useEffect(() => {
    if (!active || !inView) return;
    const id = setInterval(() => setTick((t) => Math.min(t + 1, AWARD_TICK)), slow ? BLOCK_MS * 3 : BLOCK_MS);
    return () => clearInterval(id);
  }, [active, inView, slow]);

  // Run once, on its own, the first time a reader reaches it.
  useEffect(() => {
    if (!inView || autoPlayed.current || reduce) return;
    const id = setTimeout(() => {
      autoPlayed.current = true;
      setTick(0);
      setRunning(true);
    }, 450);
    return () => clearTimeout(id);
  }, [inView, reduce]);

  const runAuction = () => {
    autoPlayed.current = true;
    const fresh = !running && tick === 0;
    if (!fresh) setScenario((s) => (s + 1) % SCENARIOS.length);
    setRunCount((c) => c + 1);
    setTick(0);
    setRunning(true);
  };

  const bids = SCENARIOS[scenario];
  const { leader, skipped } = resolve(bids, tick);
  const phase = phaseAt(tick);
  const block = BASE_BLOCK + runCount * 40 + tick;
  const changeCents = leader ? demo.limitCents - leader.cents : 0;
  const winner = leader ? BIDDERS[leader.bidder] : null;

  const buttonLabel = active ? "Restart" : tick >= AWARD_TICK ? "Run again" : "Run auction";

  return (
    <div
      ref={rootRef}
      className="rounded-[28px] bg-night-raised p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_0_0_1px_rgb(255_255_255/0.06),0_40px_120px_-40px_rgb(110_84_255/0.35)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-night-line pb-5">
        <div>
          <p className="text-label text-night-muted">Order</p>
          <p className="mt-1.5 text-[1.0625rem] font-semibold tracking-[-0.01em]">
            {ngn(demo.localAmount)} → {demo.bank} <span className="figure">····{demo.accountLast4}</span>
          </p>
          <p className="text-small text-night-muted">
            Sender’s limit <span className="figure text-night-text">{dollarsFromCents(demo.limitCents)}</span>
          </p>
        </div>
        <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1.5">
          <p className="text-label text-night-muted">Monad block</p>
          <p className="figure text-[1.25rem] leading-none text-signal" aria-hidden="true">
            #{block.toLocaleString("en-US")}
          </p>
          <PhaseChip phase={phase} />
        </div>
      </div>

      <BlockTrack tick={tick} />

      <ul className="mt-5 grid gap-3 md:grid-cols-3">
        {bids.map((bid) => (
          <BidCard
            key={bid.bidder}
            bid={bid}
            status={statusOf(bid, tick, leader, skipped)}
            hash={commitment(`${runCount}:${scenario}:${bid.bidder}`)}
            reduce={!!reduce}
          />
        ))}
      </ul>

      <div className="mt-5 min-h-[9.5rem] rounded-[18px] bg-night/60 p-5 sm:min-h-[7.5rem]">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "awarded" && winner && leader ? (
            <motion.div
              key={`result-${runCount}`}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.35, ease: ease.out }}
            >
              <p className="text-body">
                <span className="font-semibold">
                  {winner.name}, {winner.place}
                </span>{" "}
                wins at <span className="figure font-semibold">{dollarsFromCents(leader.cents)}</span>. They pay{" "}
                {ngn(demo.localAmount)} from their own bank account.
              </p>
              <p className="mt-1.5 text-body text-night-muted">
                The sender’s limit was {dollarsFromCents(demo.limitCents)}, so{" "}
                <span className="figure font-semibold text-night-text">{dollarsFromCents(changeCents)}</span> goes back to
                the sender — not to Rail.
              </p>
              {skipped.size > 0 && (
                <p className="mt-2.5 flex items-start gap-2 text-small text-caution">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  The lowest bid was skipped: its provider hadn’t staked enough to cover 110% of it.
                </p>
              )}
              {/* Every figure above is derived from this rate, so the rate shows its age. */}
              <p className="mt-3 text-small text-night-muted">
                Priced at {demo.rate.toLocaleString()} naira to the dollar, the market rate on{" "}
                {demo.rateAsOf}. A live transfer is quoted at the rate when you send.
              </p>
            </motion.div>
          ) : (
            <motion.p
              key={phase}
              className="text-body text-night-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.2 }}
            >
              {phase === "ready" && "Three providers are ready to bid on this transfer. Press run."}
              {phase === "commit" &&
                "Commit — each provider locks in a price as a sealed fingerprint. Nobody can see anyone else’s."}
              {phase === "reveal" &&
                "Reveal — prices open one by one. The lowest bid wins, but only if its provider has staked enough to cover it."}
            </motion.p>
          )}
        </AnimatePresence>
        <p className="sr-only" aria-live="polite">
          {phase === "awarded" && winner && leader
            ? `Auction finished. ${winner.name}, ${winner.place}, won at ${dollarsFromCents(leader.cents)}. ${dollarsFromCents(changeCents)} returned to the sender.`
            : ""}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={runAuction} className="btn btn-primary">
            {tick === 0 && !running ? (
              <Play className="size-4" strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" strokeWidth={2.4} aria-hidden="true" />
            )}
            {buttonLabel}
          </button>
          <SpeedToggle slow={slow} onChange={setSlow} />
        </div>
        <p className="text-label text-night-muted">Simulation · Monad’s real 300ms block time</p>
      </div>
    </div>
  );
}

function PhaseChip({ phase }: { phase: Phase }) {
  const label = { ready: "Ready", commit: "Commit", reveal: "Reveal", awarded: "Awarded" }[phase];
  return (
    <span
      className={cn(
        "text-label inline-flex h-6 items-center rounded-chip px-2 transition-colors duration-200",
        phase === "awarded" ? "bg-accent text-white" : "bg-night-line text-night-text",
      )}
    >
      {label}
    </span>
  );
}

function BlockTrack({ tick }: { tick: number }) {
  return (
    <div className="mt-5" aria-hidden="true">
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: REVEAL_END }, (_, i) => {
          const n = i + 1;
          const filled = tick >= n;
          return (
            <span key={n} className="h-1.5 overflow-hidden rounded-full bg-night-line">
              <span
                className={cn(
                  "block h-full origin-left rounded-full transition-transform duration-200 ease-out",
                  n <= COMMIT_END ? "bg-signal" : "bg-accent",
                )}
                style={{ transform: `scaleX(${filled ? 1 : 0})` }}
              />
            </span>
          );
        })}
      </div>
      <div className="text-label mt-2 grid grid-cols-2 gap-1 text-night-muted">
        <span>Commit · 5 blocks</span>
        <span>Reveal · 5 blocks</span>
      </div>
    </div>
  );
}

function BidCard({ bid, status, hash, reduce }: { bid: Bid; status: Status; hash: string; reduce: boolean }) {
  const bidder = BIDDERS[bid.bidder];
  const revealed = status !== "waiting" && status !== "sealed";
  const locked = status === "leading" || status === "won";
  const need = collateralFor(bid.cents);

  return (
    <li
      className={cn(
        "rounded-[18px] bg-night/50 p-4 transition-[box-shadow,opacity] duration-300",
        status === "won"
          ? "shadow-[inset_0_0_0_2px_var(--color-accent),0_12px_40px_-12px_rgb(110_84_255/0.6)]"
          : status === "leading"
            ? "shadow-[inset_0_0_0_1.5px_rgb(110_84_255/0.7)]"
            : "shadow-[inset_0_0_0_1px_var(--color-night-line)]",
        status === "lost" && "opacity-55",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold leading-tight tracking-[-0.01em]">{bidder.name}</p>
          <p className="text-small text-night-muted">{bidder.place}</p>
        </div>
        <StatusChip status={status} />
      </div>

      <div className="mt-4 h-[84px] [perspective:900px]">
        {reduce ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={revealed ? "back" : status}
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {revealed ? <RevealedFace cents={bid.cents} /> : <SealedFace status={status} hash={hash} />}
            </motion.div>
          </AnimatePresence>
        ) : (
          <motion.div
            className="flip relative h-full"
            initial={false}
            animate={{ rotateY: revealed ? 180 : 0 }}
            transition={spring.settle}
          >
            <div className="flip-face absolute inset-0">
              <SealedFace status={status} hash={hash} />
            </div>
            <div className="flip-face flip-back absolute inset-0">
              <RevealedFace cents={bid.cents} />
            </div>
          </motion.div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-[0.75rem]">
          <span className="text-night-muted">
            {locked
              ? "Collateral locked · 110%"
              : status === "skipped"
                ? `Needs ${dollarsFromCents(need)} staked`
                : `Free stake ${wholeUsd(bidder.freeStakeCents)}`}
          </span>
          <span className={cn("figure", status === "skipped" ? "text-caution" : "text-night-text")}>
            {locked ? dollarsFromCents(need) : status === "skipped" ? `has ${wholeUsd(bidder.freeStakeCents)}` : ""}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-night-line">
          <span
            className="block h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${locked ? 1 : 0})` }}
          />
        </div>
      </div>
    </li>
  );
}

function SealedFace({ status, hash }: { status: Status; hash: string }) {
  if (status === "waiting") {
    return (
      <div className="grid h-full place-items-center rounded-[12px] border border-dashed border-night-line text-small text-night-muted">
        Waiting to bid
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-1 rounded-[12px] bg-night-line/60 px-3.5">
      <p className="flex items-center gap-1.5 text-small font-medium">
        <Lock className="size-3.5 text-signal" strokeWidth={2.4} aria-hidden="true" /> Sealed bid
      </p>
      <p className="figure text-[0.8125rem] text-night-muted">{hash}</p>
    </div>
  );
}

function RevealedFace({ cents }: { cents: number }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-[12px] bg-night-line/60 px-3.5">
      <p className="figure text-[1.75rem] leading-none tracking-[-0.02em]">{dollarsFromCents(cents)}</p>
      <p className="mt-1.5 text-[0.75rem] text-night-muted">to deliver {ngn(demo.localAmount)}</p>
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const config: Record<Status, { label: string; className: string } | null> = {
    waiting: null,
    sealed: { label: "Committed", className: "bg-night-line text-night-muted" },
    leading: { label: "Leading", className: "bg-accent/20 text-accent-soft" },
    outbid: { label: "Outbid", className: "bg-night-line text-night-muted" },
    skipped: { label: "Stake too low", className: "bg-caution/15 text-caution" },
    won: { label: "Won", className: "bg-accent text-white" },
    lost: { label: "Outbid", className: "bg-night-line text-night-muted" },
  };
  const chip = config[status];
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {chip && (
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
          transition={spring.settle}
          className={cn("text-label inline-flex h-6 shrink-0 items-center gap-1 rounded-chip px-2", chip.className)}
        >
          {status === "won" && <Trophy className="size-3" strokeWidth={2.4} aria-hidden="true" />}
          {chip.label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function SpeedToggle({ slow, onChange }: { slow: boolean; onChange: (slow: boolean) => void }) {
  const options = [
    { value: false, label: "Real speed" },
    { value: true, label: "Slow ×3" },
  ];
  return (
    <div role="radiogroup" aria-label="Auction speed" className="relative flex rounded-[12px] bg-night p-1">
      {options.map((option) => {
        const checked = slow === option.value;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={cn(
              "press relative h-9 rounded-[9px] px-3 text-small font-medium transition-colors duration-150",
              checked ? "text-night-text" : "text-night-muted hover:text-night-text",
            )}
          >
            {checked && (
              <motion.span
                layoutId="speed-pill"
                className="absolute inset-0 rounded-[9px] bg-night-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]"
                transition={spring.settle}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
