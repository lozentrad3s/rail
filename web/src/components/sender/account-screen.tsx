"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, ArrowRight, CircleAlert, Droplets, Landmark, Plus, RefreshCw, Send } from "lucide-react";
import { Notice, Screen } from "./screen";
import { AddMoney } from "./add-money";
import { Dashboard } from "./dashboard";
import { cn, usd } from "@/lib/format";
import { spring } from "@/lib/motion";
import { isPractice, readBalance } from "@/lib/account/chain";
import { addPracticeMoney, ApiError } from "@/lib/rail-api";
import { readStanding } from "@/lib/provider/registry";
import {
  forgetLinked,
  linkedAddress,
  linkedSnapshot,
  serverLinkedSnapshot,
  subscribeLinked,
} from "@/lib/account/signer";
import {
  accountSnapshot,
  forgetAccount,
  parseAccount,
  restoreAccount,
  serverAccountSnapshot,
  subscribeAccount,
} from "@/lib/account/passkey";

/**
 * The dashboard, for either kind of account.
 *
 * Two doors lead here: a Rail account made with Face ID, and an account the person already kept
 * elsewhere and linked on the connect surface. Both land on the same screen because from here on
 * they are the same thing — an address holding dollars that only its owner can move.
 *
 * It used to read the passkey store alone, which sent everyone who came through the second door
 * straight back to sign-up. What differs between the two is small and marked below: a linked account
 * has no second derived key, so there is no savings pocket, and there is nothing to top up because
 * its dollars are already where they live.
 */
export function AccountScreen() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeAccount, accountSnapshot, serverAccountSnapshot);
  const account = useMemo(() => parseAccount(raw), [raw]);
  const reduce = useReducedMotion();

  const [dollars, setDollars] = useState<number | null>(null);
  const [savingsDollars, setSavingsDollars] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);
  const [topping, setTopping] = useState(false);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  const [isProvider, setIsProvider] = useState(false);

  const linked = useSyncExternalStore(
    subscribeLinked,
    linkedSnapshot,
    serverLinkedSnapshot,
  );

  const address = account?.address ?? linked ?? undefined;
  const savingsAddress = account?.savingsAddress;

  /**
   * Sign-up is for people with no account, not for people mid-hydration.
   *
   * Both stores report the server's null until hydration finishes, so this reads them directly at
   * effect time instead of trusting the rendered snapshot. Trusting it sends somebody who has an
   * account straight back to sign-up for a frame.
   */
  useEffect(() => {
    if (accountSnapshot() === null && linkedAddress() === null) router.replace("/start");
  }, [raw, linked, router]);

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

  /**
   * A linked account that has staked is a provider as well as a sender. It used to land here with no
   * way to its provider screen, which from the inside looked like the provider screen did not exist.
   */
  useEffect(() => {
    if (account || !linked) return;
    let cancelled = false;
    readStanding(linked)
      .then((standing) => {
        if (!cancelled) setIsProvider(standing.staked > 0n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account, linked]);

  /**
   * Practice money, on the test network only. A Face ID account starts with nothing and has no way
   * to pay a fee, so without this a first-time visitor could look at the app and never use it.
   */
  const addPractice = async () => {
    if (!address) return;
    setTopping(true);
    setTopUpNote(null);
    const before = dollars ?? 0;
    try {
      await addPracticeMoney(address);
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const { dollars: now } = await readBalance(address);
        if (now > before) {
          setDollars(now);
          setTopUpNote(`${usd(now - before)} of practice money added.`);
          return;
        }
      }
      setTopUpNote("On its way. Tap refresh in a few seconds.");
    } catch (error) {
      setTopUpNote(
        error instanceof ApiError && error.reason === "too-soon"
          ? "Practice money was just added. You can add more in a minute."
          : "Could not add practice money right now. Try again in a moment.",
      );
    } finally {
      setTopping(false);
    }
  };

  if (!address) return null;

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
              {dollars === null ? <span className="text-night-muted">$-.--</span> : usd(dollars)}
            </motion.p>

            <p className="text-small mt-3 max-w-[20rem] text-night-muted">
              {account
                ? "Held in dollars. Nobody can move it without your face. Not us, and not anyone holding your phone."
                : "Held in dollars, in the account you already had. Rail cannot move any of it: each transfer asks you to approve exactly what it costs."}
            </p>
          </div>
        </section>

        {isPractice ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => void addPractice()}
              disabled={topping}
              className={cn("btn btn-sm clay-press", dollars === 0 ? "btn-primary" : "btn-secondary-paper")}
            >
              <Droplets className="size-4" strokeWidth={2.2} aria-hidden="true" />
              {topping ? "Adding…" : "Add $10,000 practice money"}
            </button>
            {topUpNote ? (
              <p className="text-small text-ink-muted" role="status">
                {topUpNote}
              </p>
            ) : dollars === 0 ? (
              <p className="text-small text-ink-muted">Free during the pilot, so you can try a real transfer.</p>
            ) : null}
          </div>
        ) : null}

        {isProvider ? (
          <a href="/provider" className="clay clay-press mt-3 flex items-center gap-3 px-5 py-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-accent shadow-[var(--clay-raise)]">
              <Landmark className="size-5" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">You are a provider too</span>
              <span className="text-small block text-ink-muted">Open your provider dashboard</span>
            </span>
            <ArrowRight className="size-5 shrink-0 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
          </a>
        ) : null}

        {unreachable ? (
          <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="Can't reach your balance">
            Your money is safe. This is the connection, not your account. Tap refresh in a moment.
          </Notice>
        ) : null}

        {/*
         * One passkey, two accounts. The second costs no extra prompt and no extra passkey.
         *
         * A linked account has no second key to derive, so there is nothing honest to show here and
         * the row is left out rather than offered and broken.
         */}
        {account ? (
        <section className="clay mt-3 flex items-center justify-between gap-3 px-5 py-4">
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
              {savingsDollars === null ? "$-.--" : usd(savingsDollars)}
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
        ) : null}

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <Action icon={<Send className="size-[19px]" strokeWidth={2} />} label="Send" />
          <Action icon={<Plus className="size-[19px]" strokeWidth={2} />} label="Add money" />
          <Action icon={<ArrowDownLeft className="size-[19px]" strokeWidth={2} />} label="Request" />
        </div>
        <Dashboard address={address} />

        {/* Topping up is for a Rail account. A linked one already holds its dollars where they are. */}
        {account ? <AddMoney address={address} /> : null}

        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={() => {
              if (!confirmForget) {
                setConfirmForget(true);
                return;
              }
              if (account) forgetAccount();
              else {
                forgetLinked();
                router.replace("/start");
              }
            }}
            className="text-small press rounded-lg py-1 text-ink-muted underline decoration-line underline-offset-4"
          >
            {confirmForget ? "Tap again to remove it" : "Remove this account from this phone"}
          </button>
          {confirmForget ? (
            <p className="text-small mt-2 text-ink-muted">
              {account
                ? "Your money stays where it is. Face ID brings the account back on any phone."
                : "Your money stays where it is. This only forgets it on this phone, and you can link it again."}
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
