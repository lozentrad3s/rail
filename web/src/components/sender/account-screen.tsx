"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, CircleAlert, Plus, RefreshCw, Send } from "lucide-react";
import { Notice, Screen } from "./screen";
import { cn, usd } from "@/lib/format";
import { spring } from "@/lib/motion";
import { isPractice, readBalance } from "@/lib/account/chain";
import {
  accountSnapshot,
  forgetAccount,
  parseAccount,
  restoreAccount,
  serverAccountSnapshot,
  subscribeAccount,
} from "@/lib/account/passkey";

export function AccountScreen() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeAccount, accountSnapshot, serverAccountSnapshot);
  const account = useMemo(() => parseAccount(raw), [raw]);
  const address = account?.address;
  const reduce = useReducedMotion();

  const [dollars, setDollars] = useState<number | null>(null);
  const [savingsDollars, setSavingsDollars] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);
  const savingsAddress = account?.savingsAddress;

  useEffect(() => {
    if (raw === null) router.replace("/start");
  }, [raw, router]);

  // Read on arrival, on request, and whenever the person returns to the tab — money may have landed.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const read = async () => {
      setReading(true);
      try {
        // Both accounts belong to the same passkey, so both balances come back without a prompt.
        const [spending, savings] = await Promise.all([
          readBalance(address),
          savingsAddress ? readBalance(savingsAddress) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setDollars(spending.dollars);
          setSavingsDollars(savings ? savings.dollars : null);
          setUnreachable(false);
        }
      } catch {
        if (!cancelled) setUnreachable(true);
      } finally {
        if (!cancelled) setReading(false);
      }
    };

    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, savingsAddress, reload]);

  if (!account) return null;

  return (
    <Screen>
      <div className="flex flex-1 flex-col">
        {/* Money is the heaviest thing on the screen, so it is the darkest. */}
        <section className="relative mt-7 overflow-hidden rounded-[28px] bg-night px-6 pb-7 pt-6 text-night-text shadow-float">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: "var(--grad-money)" }}
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <p className="text-label text-night-muted">Your balance</p>
              <div className="flex items-center gap-2">
                {isPractice ? <span className="chip chip-night">Practice money</span> : null}
                <button
                  type="button"
                  onClick={() => setReload((n) => n + 1)}
                  className="press -m-2 grid size-10 place-items-center rounded-full text-night-muted"
                  aria-label="Check for money that has just arrived"
                >
                  <RefreshCw
                    className={cn("size-[18px]", reading && !reduce && "animate-spin")}
                    strokeWidth={2.2}
                  />
                </button>
              </div>
            </div>

            <motion.p
              key={dollars === null ? "pending" : "value"}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.settle}
              className="figure mt-3 text-[clamp(2.75rem,2rem+3vw,3.25rem)] leading-none tracking-[-0.03em]"
              aria-live="polite"
            >
              {dollars === null ? <span className="text-night-muted">$—</span> : usd(dollars)}
            </motion.p>

            <p className="text-small mt-3 max-w-[20rem] text-night-muted">
              Held in dollars. Nobody can move it without your face — not us, not anyone holding your
              phone.
            </p>
          </div>
        </section>

        {unreachable ? (
          <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="Can't reach your balance">
            Your money is safe — this is the connection, not your account. Tap refresh in a moment.
          </Notice>
        ) : null}

        {/* One passkey, two accounts. The second costs no extra prompt and no extra passkey. */}
        <section className="mt-3 flex items-center justify-between gap-3 rounded-[18px] bg-surface px-5 py-4 shadow-card">
          <div className="min-w-0">
            <p className="text-label text-ink-muted">Savings</p>
            <p className="text-small mt-1 text-ink-muted">
              {savingsAddress
                ? "Kept apart from your spending money. Same Face ID."
                : "Face ID sets up a separate savings account for you."}
            </p>
          </div>
          {savingsAddress ? (
            <p className="figure shrink-0 text-[1.375rem] leading-none tracking-[-0.02em]">
              {savingsDollars === null ? "$—" : usd(savingsDollars)}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void restoreAccount().catch(() => setUnreachable(true))}
              className="btn btn-sm btn-secondary-paper shrink-0"
            >
              Turn on
            </button>
          )}
        </section>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <Action icon={<Send className="size-[19px]" strokeWidth={2} />} label="Send" />
          <Action icon={<Plus className="size-[19px]" strokeWidth={2} />} label="Add money" />
          <Action icon={<ArrowDownLeft className="size-[19px]" strokeWidth={2} />} label="Request" />
        </div>
        <p className="text-small mt-3 text-ink-muted">
          Sending opens with the pilot in October. You can set up your account today.
        </p>

        <section className="mt-9">
          <h2 className="text-label text-ink-muted">Transfers</h2>
          <div className="mt-3 rounded-[18px] border border-dashed border-line px-4 py-7 text-center">
            <p className="text-small text-ink-muted">
              Nothing yet. Every transfer you make will show here, with what it cost and how long it
              took.
            </p>
          </div>
        </section>

        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={() => {
              if (!confirmForget) {
                setConfirmForget(true);
                return;
              }
              forgetAccount();
            }}
            className="text-small press rounded-lg py-1 text-ink-muted underline decoration-line underline-offset-4"
          >
            {confirmForget ? "Tap again to remove it" : "Remove this account from this phone"}
          </button>
          {confirmForget ? (
            <p className="text-small mt-2 text-ink-muted">
              Your money stays where it is. Face ID brings the account back on any phone.
            </p>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}

/**
 * One of the three things you can do with money.
 *
 * Rendered as an honest disabled state rather than a dead link, so nothing on this screen promises
 * something that is not built yet.
 */
function Action({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      role="link"
      aria-disabled="true"
      title={`${label} opens with the pilot`}
      className="flex min-h-[4.5rem] cursor-not-allowed flex-col items-center justify-center gap-1.5 rounded-[18px] border border-line bg-surface/50 text-[0.8125rem] font-medium text-ink-muted"
    >
      <span className="text-accent/45" aria-hidden="true">
        {icon}
      </span>
      {label}
    </span>
  );
}
