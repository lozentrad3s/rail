"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { CheckCheck, CircleCheck, Lock, RotateCcw, ScanFace } from "lucide-react";
import { cn, ngn, dollarsFromCents } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { demo } from "@/lib/site";
import { RailMark } from "./primitives";

/**
 * The whole product in one phone: a chat proposes, Face ID authorises, providers compete, money lands.
 * Each step is a duration; everything on screen is derived from the current step, so replaying or
 * pausing (offscreen) never leaves the UI in a half-state.
 */
const STEP = {
  idle: 0,
  typing: 1,
  sent: 2,
  botTyping: 3,
  quote: 4,
  tap: 5,
  scanning: 6,
  approved: 7,
  sheetClosed: 8,
  bidding: 9,
  delivered: 10,
} as const;

const DURATION_MS: Record<number, number> = {
  [STEP.idle]: 700,
  [STEP.typing]: 1100,
  [STEP.sent]: 450,
  [STEP.botTyping]: 900,
  [STEP.quote]: 1900,
  [STEP.tap]: 380,
  [STEP.scanning]: 1150,
  [STEP.approved]: 750,
  [STEP.sheetClosed]: 350,
  [STEP.bidding]: 1700,
};

const LAST = STEP.delivered;
const changeCents = demo.limitCents - demo.winningBidCents;

export function ChatDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef, { amount: 0.35 });
  const reduce = useReducedMotion();
  const [step, setStep] = useState<number>(STEP.idle);
  const [run, setRun] = useState(0);
  const [pageReady, setPageReady] = useState(false);

  // Reduced motion shows the finished conversation — same information, no movement.
  const current = reduce ? LAST : step;

  // Autoplay waits for the page to load and go idle, so the demo never competes with first paint.
  useEffect(() => {
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if ("requestIdleCallback" in window) {
        idle = window.requestIdleCallback(() => setPageReady(true), { timeout: 1500 });
      } else {
        timer = setTimeout(() => setPageReady(true), 0);
      }
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (reduce || !pageReady || !inView || step >= LAST) return;
    const timer = setTimeout(() => setStep((s) => s + 1), DURATION_MS[step]);
    return () => clearTimeout(timer);
  }, [step, inView, reduce, run, pageReady]);

  const replay = () => {
    setStep(STEP.idle);
    setRun((r) => r + 1);
  };

  const sheetOpen = current === STEP.scanning || current === STEP.approved;

  return (
    <figure className="flex flex-col items-center gap-4">
      <div
        ref={frameRef}
        className="relative w-[300px] rounded-phone bg-[#05030b] p-[10px] shadow-[0_40px_120px_-30px_rgb(110_84_255/0.55),inset_0_0_0_1px_rgb(255_255_255/0.1)] sm:w-[320px]"
      >
        <span className="sr-only">
          Illustrative conversation. You type “send 50k to mum”. Rail replies with {ngn(demo.localAmount)} to{" "}
          {demo.recipientName}, {demo.bank} ending {demo.accountLast4}, and a button to confirm with Face ID. You
          approve with Face ID. Providers bid, and a moment later Rail confirms delivery and returns{" "}
          {dollarsFromCents(changeCents)} of the price you set.
        </span>

        <div
          aria-hidden="true"
          className="relative flex h-[610px] flex-col overflow-hidden rounded-[34px] bg-chat text-ink sm:h-[650px]"
        >
          <StatusBar />
          <ChatHeader />

          <div className="relative flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 pb-3" key={run}>
            <AnimatePresence initial={false}>
              {current >= STEP.sent && (
                <Bubble key="user" side="out">
                  send 50k to mum
                  <Meta>
                    9:41 <CheckCheck className="size-3.5 text-accent" strokeWidth={2.2} />
                  </Meta>
                </Bubble>
              )}

              {current === STEP.botTyping && (
                <Bubble key="typing" side="in">
                  <span className="flex h-5 items-center gap-1 px-1">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                </Bubble>
              )}

              {current >= STEP.quote && (
                <Bubble key="quote" side="in" wide>
                  <QuoteCard state={current === STEP.tap ? "pressed" : current >= STEP.scanning ? "approved" : "ready"} />
                </Bubble>
              )}

              {current >= STEP.bidding && (
                <Bubble key="bidding" side="in">
                  <span className="text-[0.8125rem] leading-snug">
                    {current >= STEP.delivered ? "Providers bid for your transfer." : "Providers are bidding for your transfer…"}
                  </span>
                  <Meta>9:41</Meta>
                </Bubble>
              )}

              {current >= STEP.delivered && (
                <Bubble key="delivered" side="in" wide>
                  <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold text-money-text">
                    <CircleCheck className="size-4" strokeWidth={2.4} /> Delivered in {demo.deliveredSeconds}s
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-snug text-ink">
                    {demo.recipientFirstName}’s {demo.bank} account received {ngn(demo.localAmount)}. You paid{" "}
                    <span className="figure">{dollarsFromCents(demo.winningBidCents)}</span> and{" "}
                    <span className="figure font-semibold">{dollarsFromCents(changeCents)}</span> is back in your balance.
                  </p>
                  <Meta>9:42</Meta>
                </Bubble>
              )}
            </AnimatePresence>
          </div>

          <Composer typing={current === STEP.typing} />

          <AnimatePresence>
            {sheetOpen && (
              <>
                <motion.div
                  key="scrim"
                  className="absolute inset-0 bg-night/35"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.25, ease: ease.out }}
                />
                <FaceIdSheet key="sheet" approved={current === STEP.approved} />
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <figcaption className="flex items-center gap-3">
        <span className="text-label text-night-muted">Illustrative conversation</span>
        <button
          type="button"
          onClick={replay}
          className="btn btn-sm btn-secondary-night min-h-9 gap-1.5 px-3"
          aria-label="Replay the conversation"
        >
          <RotateCcw className="size-3.5" strokeWidth={2.2} /> Replay
        </button>
      </figcaption>
    </figure>
  );
}

function StatusBar() {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between px-6 pt-1 text-[0.8125rem] font-semibold">
      <span className="figure">9:41</span>
      <span className="absolute left-1/2 top-2.5 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-[#05030b]" />
      <span className="flex items-center gap-1">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" />
          <rect x="23" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

function ChatHeader() {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-surface/80 px-4 pb-2.5 pt-1">
      <RailMark className="size-9" />
      <div className="min-w-0 leading-tight">
        <p className="text-[0.9375rem] font-semibold tracking-[-0.01em]">Rail</p>
        <p className="text-[0.75rem] text-ink-muted">Business account</p>
      </div>
      <Lock className="ml-auto size-4 text-ink-muted" strokeWidth={2} />
    </div>
  );
}

function Bubble({ side, wide, children }: { side: "in" | "out"; wide?: boolean; children: ReactNode }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={spring.settle}
      style={{ transformOrigin: side === "out" ? "100% 100%" : "0% 100%" }}
      className={cn(
        "relative max-w-[82%] rounded-[18px] px-3 py-2 shadow-[0_1px_1px_rgb(14_9_28/0.08)]",
        wide && "w-[82%]",
        side === "out"
          ? "self-end rounded-br-[6px] bg-accent-soft text-ink"
          : "self-start rounded-bl-[6px] bg-surface text-ink",
      )}
    >
      {children}
    </motion.div>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="figure float-right ml-3 mt-1.5 flex items-center gap-1 text-[0.6875rem] text-ink-muted">
      {children}
    </span>
  );
}

function QuoteCard({ state }: { state: "ready" | "pressed" | "approved" }) {
  return (
    <div className="text-[0.8125rem] leading-snug">
      <p className="text-[1.0625rem] font-semibold tracking-[-0.015em]">{ngn(demo.localAmount)}</p>
      <p className="font-medium">to {demo.recipientName}</p>
      <p className="text-ink-muted">
        {demo.bank} <span className="figure">····{demo.accountLast4}</span>
      </p>
      <dl className="mt-2 space-y-0.5 border-t border-line pt-2">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">You pay at most</dt>
          <dd className="figure">{dollarsFromCents(demo.limitCents)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Fee</dt>
          <dd className="figure">{dollarsFromCents(demo.feeCents)}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[0.75rem] text-ink-muted">Providers compete to lower your price.</p>
      <span
        className={cn(
          "mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[0.8125rem] font-semibold transition-[transform,background-color,color] duration-150",
          state === "approved" ? "bg-accent-soft text-accent" : "bg-accent text-white",
          state === "pressed" && "scale-[0.96]",
        )}
      >
        {state === "approved" ? (
          <>
            <CircleCheck className="size-4" strokeWidth={2.4} /> Confirmed
          </>
        ) : (
          <>
            <ScanFace className="size-4" strokeWidth={2.2} /> Confirm with Face ID
          </>
        )}
      </span>
    </div>
  );
}

function Composer({ typing }: { typing: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface/80 px-3 py-2.5">
      <div className="flex h-9 flex-1 items-center rounded-full bg-surface px-3.5 text-[0.875rem] shadow-[inset_0_0_0_1px_rgb(14_9_28/0.08)]">
        {typing ? (
          <span className="typewriter">send 50k to mum</span>
        ) : (
          <span className="text-ink-muted">Message</span>
        )}
      </div>
      <span className="grid size-9 place-items-center rounded-full bg-accent text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3.4 20.4 21 12 3.4 3.6l.1 6.5L15 12 3.5 13.9z" />
        </svg>
      </span>
    </div>
  );
}

function FaceIdSheet({ approved }: { approved: boolean }) {
  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-surface px-6 pb-8 pt-3 text-center shadow-float"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%", transition: { duration: 0.28, ease: ease.drawer } }}
      transition={spring.sheet}
    >
      <span className="mx-auto mb-5 block h-1 w-9 rounded-full bg-line" />
      <div className="relative mx-auto grid size-16 place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          {approved ? (
            <motion.span
              key="ok"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.settle}
            >
              <CircleCheck className="size-14 text-money" strokeWidth={1.8} />
            </motion.span>
          ) : (
            <motion.span
              key="scan"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={spring.settle}
              className="relative"
            >
              <ScanFace className="size-14 text-accent" strokeWidth={1.6} />
              <motion.span
                className="absolute inset-x-1 top-1 h-0.5 rounded-full bg-accent/70"
                animate={{ y: [0, 44, 0] }}
                transition={{ duration: 1.1, ease: ease.inOut, repeat: Infinity }}
              />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-3 text-[1rem] font-semibold tracking-[-0.01em]">
        {approved ? "Approved" : `Send ${ngn(demo.localAmount)} to ${demo.recipientFirstName}?`}
      </p>
      <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
        {approved ? "Only your face can approve this." : "Look at your phone to confirm"}
      </p>
    </motion.div>
  );
}
