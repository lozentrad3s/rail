"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Landmark, ScanFace, ShieldCheck } from "lucide-react";
import { Assurance, Notice, Screen } from "./screen";
import { cn, ngn, usd } from "@/lib/format";
import { spring } from "@/lib/motion";
import { ApiError } from "@/lib/rail-api";
import {
  approveProposal,
  checkFunds,
  loadProposal,
  type Funds,
  type Proposal,
} from "@/lib/transfer";
import { preferredSigner, signerFailure, type SignerKind } from "@/lib/account/signer";
import { unlockKind, unlockName, unlockWaiting } from "@/lib/unlock";
import { useDeviceFact } from "@/lib/use-device-fact";

type Failure = { title: string; detail: string };

const UNKNOWN: Failure = {
  title: "That didn't work",
  detail: "Please try again. Nothing has left your account.",
};

const FAILURES: Record<string, Failure> = {
  cancelled: {
    title: "Face ID was cancelled",
    detail: "Nothing has left your account. Tap again whenever you're ready.",
  },
  expired: {
    title: "This request has expired",
    detail: "Prices move, so a request only lasts a few minutes. Ask again in the chat.",
  },
  offline: {
    title: "We couldn't reach Rail",
    detail: "Check your connection and try again. Nothing has left your account.",
  },
  rejected: {
    title: "That was declined",
    detail: "Nothing has left your account. Tap again whenever you are ready.",
  },
  "wrong-chain": {
    title: "Your other app is set to the wrong network",
    detail: "Switch it over and try again. Nothing has left your account.",
  },
  "chain-add-failed": {
    title: "Your other app could not add the network",
    detail: "Add it there yourself, then come back and try again.",
  },
  "none-available": {
    title: "Nothing on this device can approve",
    detail: "Set up Face ID, or open Rail in an app that can approve payments.",
  },
  short: {
    title: "Not enough in your account",
    detail:
      "Nothing has left it. Add a little more and this request will still be here for a few minutes.",
  },
  unknown: UNKNOWN,
};

/**
 * The last of the four taps.
 *
 * Everything the chat proposed is shown here in full — including the account number, which appears
 * on this screen and nowhere else — because this is the moment a person can still say no.
 */
export function ApproveScreen({ draftId }: { draftId: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Which key this device can sign with, and what to call unlocking it. The server knows neither.
  const signer = useDeviceFact<SignerKind | null | undefined>(
    () => preferredSigner() ?? null,
    undefined,
  );
  const kind = useDeviceFact(unlockKind, "generic");

  /**
   * What the account holds, read once the proposal and the signer are both known.
   *
   * undefined means "could not tell", which is not "empty" — the button stays available, because a
   * connection problem must not stop somebody sending their own money, and the amount is checked
   * again before anything is spent.
   */
  const [funds, setFunds] = useState<Funds | undefined>(undefined);
  const shortfall = funds?.short ?? 0;

  useEffect(() => {
    if (!proposal || !signer) return;
    let cancelled = false;
    void checkFunds(proposal, signer).then((read) => {
      if (!cancelled) setFunds(read);
    });
    return () => {
      cancelled = true;
    };
  }, [proposal, signer]);

  useEffect(() => {
    let cancelled = false;
    loadProposal(draftId)
      .then((loaded) => {
        if (!cancelled) setProposal(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailure(FAILURES[error instanceof ApiError ? error.reason : "unknown"] ?? UNKNOWN);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const approve = async () => {
    if (!proposal || !signer) return;
    setBusy(true);
    setFailure(null);
    try {
      const { reference: orderReference } = await approveProposal(proposal, signer);
      setReference(orderReference);
    } catch (error) {
      const reason = error instanceof ApiError ? error.reason : signerFailure(error) ?? "unknown";
      setFailure(FAILURES[reason] ?? UNKNOWN);
    } finally {
      setBusy(false);
    }
  };

  if (signer === null) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col justify-center py-12">
          <h1 className="text-h2">Set up Rail first</h1>
          <p className="text-lead mt-4 text-ink-muted">
            You need an account on this phone before you can approve a transfer. It takes one look.
          </p>
          <button
            type="button"
            onClick={() => router.push("/start")}
            className="btn btn-primary mt-9 w-full"
          >
            <ScanFace className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
            Set up with {unlockName(kind)}
          </button>
          <button
            type="button"
            onClick={() => router.push("/connect")}
            className="btn btn-secondary-paper mt-3 w-full"
          >
            Use an account I already have
          </button>
        </div>
      </Screen>
    );
  }

  if (reference) {
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
            <h1 className="text-h2 mt-6">On its way.</h1>
            <p className="text-lead mt-4 text-ink-muted">
              {proposal
                ? `${ngn(Number(proposal.localAmountMinor) / 100)} to ${proposal.recipient.contactName}. `
                : ""}
              We&apos;ll let you know in the chat the moment it lands.
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
    <Screen className="relative isolate">
      {/* One soft light source, placed where the eye should land — docs/DESIGN.md §2.1 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
        style={{
          background: "radial-gradient(90% 60% at 50% 0%, rgb(110 84 255 / 0.13), transparent 70%)",
        }}
      />

      <div className="flex flex-1 flex-col justify-center py-12">
        {proposal ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.settle}
          >
            <p className="text-small text-ink-muted">You are sending</p>
            {/* Money is the heaviest thing on the screen, so it is the darkest. */}
            <p className="text-h1 mt-1 tabular-nums">
              {ngn(Number(proposal.localAmountMinor) / 100)}
            </p>

            <div className="clay mt-7 p-4">
              <p className="text-small text-ink-muted">To</p>
              <p className="mt-0.5 text-[1.0625rem] font-semibold">
                {proposal.recipient.accountName}
              </p>
              <p className="text-small mt-1 text-ink-muted">
                {proposal.recipient.bankName} · {proposal.recipient.accountNumber}
              </p>
            </div>

            <dl className="text-small mt-5 grid gap-2">
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-muted">Worth today</dt>
                <dd className="tabular-nums">{usd(proposal.worthToday)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-muted">Most you can pay</dt>
                <dd className="font-semibold tabular-nums">{usd(proposal.mostYouPay)}</dd>
              </div>
              {/* Only once it is known. A balance that reads zero while loading is a small heart attack. */}
              {funds ? (
                <div className="flex items-baseline justify-between">
                  <dt className="text-ink-muted">In your account</dt>
                  <dd
                    className={cn(
                      "tabular-nums",
                      shortfall > 0 && "font-semibold text-slash-text",
                    )}
                  >
                    {usd(funds.available)}
                  </dd>
                </div>
              ) : null}
            </dl>

            {/*
             * Short, so there is nothing to approve yet.
             *
             * The button is replaced rather than merely disabled: a disabled button with no reason
             * beside it is the worst version of this screen, and the number is the whole point —
             * somebody can act on "$17.65 more" and cannot act on a greyed-out button.
             */}
            {shortfall > 0 ? (
              <div className="clay mt-8 p-4">
                <p className="font-semibold">
                  You need {usd(shortfall)} more to send this.
                </p>
                <p className="text-small mt-1 text-ink-muted">
                  Nothing has left your account. Add a little more and come back — this request is
                  good for a few more minutes.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/account")}
                  className="btn btn-primary mt-4 w-full"
                >
                  Add money
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void approve()}
                disabled={busy}
                aria-disabled={busy}
                className="btn btn-primary mt-8 w-full text-[1rem]"
              >
                <ScanFace className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
                {signer === "connected"
                  ? busy
                    ? "Waiting for your approval…"
                    : "Approve to send"
                  : busy
                    ? unlockWaiting(kind)
                    : `Approve with ${unlockName(kind)}`}
              </button>
            )}

            <ul className="text-small mt-9 grid gap-3.5 text-ink-muted">
              <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
                You will never pay more than the amount above, and whatever is not needed comes
                back to you.
              </Assurance>
              <Assurance icon={<Landmark className="size-[18px]" strokeWidth={2} />}>
                {proposal.recipient.contactName} receives it in their normal bank account.
              </Assurance>
            </ul>
          </motion.div>
        ) : failure ? null : (
          <p className="text-lead text-ink-muted" role="status">
            Getting the details…
          </p>
        )}

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
      </div>
    </Screen>
  );
}
