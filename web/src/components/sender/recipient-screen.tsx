"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Landmark, ShieldCheck } from "lucide-react";
import { Assurance, Notice, Screen } from "./screen";
import { spring } from "@/lib/motion";
import {
  ApiError,
  listBanks,
  resolveAccountName,
  saveContact,
  type Bank,
  type SavedContact,
} from "@/lib/rail-api";

/** The pilot sends to Nigeria. A second currency means a second list and a second minimum. */
const CURRENCY = "NGN";
const ACCOUNT_DIGITS = 10;

type Failure = { title: string; detail: string };

const UNKNOWN: Failure = {
  title: "That didn't work",
  detail: "Please try again in a moment. Nothing has been saved.",
};

const FAILURES: Record<string, Failure> = {
  expired: {
    title: "This link has expired",
    detail: "Links last fifteen minutes and open once. Ask again in the chat and we'll send a fresh one.",
  },
  "account-not-found": {
    title: "We couldn't find that account",
    detail: "Check the number and the bank, then try again.",
  },
  "not-configured": {
    title: "Name checking isn't switched on yet",
    detail: "We can't confirm who owns an account right now, so we won't let you add one blind.",
  },
  offline: {
    title: "We couldn't reach Rail",
    detail: "Check your connection and try again. Nothing has been saved.",
  },
  unknown: UNKNOWN,
};

const reasonOf = (error: unknown): string => (error instanceof ApiError ? error.reason : "unknown");

/**
 * Where a recipient's bank details are entered.
 *
 * The chat never asks for these — Meta's policy forbids requesting financial account numbers in
 * conversation, and a number pasted into WhatsApp lives in Meta's servers and the sender's history
 * forever. So the bot hands out a one-time link and the details are typed here, over HTTPS, once.
 *
 * The name the bank returns is the whole point. A sender who sees "ADAEZE O. OKONKWO" knows they
 * typed the right number; a sender who sees a stranger's name has just been saved from a mistake.
 */
export function RecipientScreen({ code }: { code: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();

  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedContact | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const complete = bankCode !== "" && accountNumber.length === ACCOUNT_DIGITS;

  useEffect(() => {
    let cancelled = false;
    listBanks(CURRENCY)
      .then((list) => {
        if (!cancelled) setBanks(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBanks([]);
          setFailure(FAILURES[reasonOf(error)] ?? UNKNOWN);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The name is looked up as soon as there is enough to look one up, so the sender never has to
  // press a button to find out they mistyped.
  useEffect(() => {
    setAccountName(null);
    if (!complete) return;

    let cancelled = false;
    setChecking(true);
    setFailure(null);

    const timer = setTimeout(() => {
      resolveAccountName({ bankCode, accountNumber })
        .then(({ accountName: name }) => {
          if (!cancelled) setAccountName(name);
        })
        .catch((error: unknown) => {
          if (!cancelled) setFailure(FAILURES[reasonOf(error)] ?? UNKNOWN);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bankCode, accountNumber, complete]);

  const bankName = useMemo(
    () => banks?.find((bank) => bank.code === bankCode)?.name ?? "",
    [banks, bankCode],
  );

  const add = async () => {
    setSaving(true);
    setFailure(null);
    try {
      setSaved(await saveContact({ code, currency: CURRENCY, bankCode, accountNumber }));
    } catch (error) {
      setFailure(FAILURES[reasonOf(error)] ?? UNKNOWN);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col justify-center py-12">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.settle}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-accent text-white">
              <Check className="size-6" strokeWidth={2.6} aria-hidden="true" />
            </span>
            <h1 className="text-h2 mt-6">{saved.contactName} is saved.</h1>
            <p className="text-lead mt-4 text-ink-muted">
              {saved.accountName} · {saved.bankName} ····{saved.accountLast4}
            </p>
            <p className="text-body mt-4 text-ink-muted">
              Go back to the chat and say{" "}
              <span className="font-semibold text-ink">
                send 50k to {saved.contactName.toLowerCase()}
              </span>
              .
            </p>
            <button
              type="button"
              onClick={() => router.replace("/account")}
              className="btn btn-secondary-paper mt-9 w-full"
            >
              See my account
            </button>
          </motion.div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-1 flex-col py-10">
        <h1 className="text-h2">Who are you sending to?</h1>
        <p className="text-lead mt-4 text-ink-muted">
          Enter their details here, not in the chat. We&apos;ll show you the name their bank has on
          file before anything is saved.
        </p>

        <div className="mt-8 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-small font-semibold">Their bank</span>
            <select
              value={bankCode}
              onChange={(event) => setBankCode(event.target.value)}
              disabled={banks === null || banks.length === 0}
              className="h-12 rounded-[14px] bg-surface px-3.5 text-[1rem] shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">{banks === null ? "Loading…" : "Choose a bank"}</option>
              {(banks ?? []).map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-small font-semibold">Their account number</span>
            <input
              value={accountNumber}
              onChange={(event) =>
                setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, ACCOUNT_DIGITS))
              }
              inputMode="numeric"
              autoComplete="off"
              placeholder={"0".repeat(ACCOUNT_DIGITS)}
              aria-describedby="account-hint"
              className="h-12 rounded-[14px] bg-surface px-3.5 font-mono text-[1rem] tracking-[0.04em] shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span id="account-hint" className="text-small text-ink-muted">
              {accountNumber.length}/{ACCOUNT_DIGITS} digits
            </span>
          </label>
        </div>

        <AnimatePresence>
          {checking || accountName ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={spring.settle}
              className="clay mt-5 p-4"
            >
              <p className="text-small text-ink-muted">Their bank says this account belongs to</p>
              <p className="mt-0.5 text-[1.0625rem] font-semibold" aria-live="polite">
                {checking ? "Checking…" : accountName}
              </p>
              {accountName ? (
                <p className="text-small mt-1 text-ink-muted">
                  {bankName} · {accountNumber}
                </p>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => void add()}
          disabled={!accountName || saving}
          aria-disabled={!accountName || saving}
          className="btn btn-primary mt-7 w-full text-[1rem]"
        >
          <Landmark className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
          {saving ? "Saving…" : accountName ? `Add ${accountName.split(" ")[0]}` : "Add"}
        </button>

        <AnimatePresence>
          {failure ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={spring.settle}
            >
              <Notice
                icon={<CircleAlert className="size-4" strokeWidth={2.2} />}
                title={failure.title}
              >
                {failure.detail}
              </Notice>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ul className="text-small mt-10 grid gap-3.5 text-ink-muted">
          <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
            Their account number is kept encrypted and never appears in the chat. Only the last
            four digits do.
          </Assurance>
        </ul>
      </div>
    </Screen>
  );
}
