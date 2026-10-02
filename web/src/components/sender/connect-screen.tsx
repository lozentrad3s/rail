"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, MessageCircle, ScanFace, ShieldCheck } from "lucide-react";
import { Assurance, Notice, Screen } from "./screen";
import { spring } from "@/lib/motion";
import { ApiError, linkAccount, linkMessage } from "@/lib/rail-api";
import {
  AccountError,
  accountSnapshot,
  parseAccount,
  serverAccountSnapshot,
  subscribeAccount,
  unlockAccount,
} from "@/lib/account/passkey";

type Failure = { title: string; detail: string };

const UNKNOWN: Failure = {
  title: "That didn't work",
  detail: "Please try again. Nothing has been connected or charged.",
};

const FAILURES: Record<string, Failure> = {
  cancelled: {
    title: "Face ID was cancelled",
    detail: "Nothing was connected. Tap again whenever you're ready.",
  },
  expired: {
    title: "This link has expired",
    detail: "Links last fifteen minutes. Say “balance” in the chat again and we'll send a fresh one.",
  },
  rejected: {
    title: "That didn't match",
    detail: "The approval didn't match this account. Try again, or ask for a new link in the chat.",
  },
  offline: {
    title: "We couldn't reach Rail",
    detail: "Check your connection and try again. Nothing was connected.",
  },
  unknown: UNKNOWN,
};

/**
 * Connecting a chat to an account.
 *
 * The proof is a signature from the account itself, which is why this screen exists at all: a chat
 * can ask to be connected to anything, and only the person holding the passkey can agree to it.
 */
export function ConnectScreen({ code }: { code: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const raw = useSyncExternalStore(subscribeAccount, accountSnapshot, serverAccountSnapshot);
  const account = parseAccount(raw);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const connect = async () => {
    setBusy(true);
    setFailure(null);

    let unlocked: Awaited<ReturnType<typeof unlockAccount>> | undefined;
    try {
      unlocked = await unlockAccount();
      const signature = await unlocked.signer.signMessage({
        message: linkMessage(code, unlocked.address),
      });
      await linkAccount({ code, address: unlocked.address, signature });
      setDone(true);
    } catch (error) {
      const reason =
        error instanceof ApiError
          ? error.reason
          : error instanceof AccountError
            ? error.reason
            : "unknown";
      setFailure(FAILURES[reason] ?? UNKNOWN);
    } finally {
      // The session ends whether or not it worked: nothing is left able to sign.
      unlocked?.end();
      setBusy(false);
    }
  };

  if (account === null) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col justify-center py-12">
          <h1 className="text-h2">Set up Rail first</h1>
          <p className="text-lead mt-4 text-ink-muted">
            You need an account on this phone before a chat can be connected to it. It takes one
            look, and there is nothing to remember.
          </p>
          <button
            type="button"
            onClick={() => router.push("/start")}
            className="btn btn-primary mt-9 w-full"
          >
            <ScanFace className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
            Set up with Face ID
          </button>
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
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="done"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.settle}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-white">
                <Check className="size-6" strokeWidth={2.6} aria-hidden="true" />
              </span>
              <h1 className="text-h2 mt-6">Connected.</h1>
              <p className="text-lead mt-4 text-ink-muted">
                Go back to the chat and say <span className="font-semibold text-ink">balance</span>.
              </p>
              <button
                type="button"
                onClick={() => router.replace("/account")}
                className="btn btn-secondary-paper mt-9 w-full"
              >
                See my account
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="ask"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.settle}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-surface text-accent shadow-[var(--clay-raise)]">
                <MessageCircle className="size-6" strokeWidth={2.2} aria-hidden="true" />
              </span>
              <h1 className="text-h2 mt-6">
                Connect your <span className="accent-serif text-accent">chat</span>.
              </h1>
              <p className="text-lead mt-4 text-ink-muted">
                One look, and your chat can show your balance and line up a transfer for you to
                approve here.
              </p>

              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy}
                aria-disabled={busy}
                className="btn btn-primary mt-9 w-full text-[1rem]"
              >
                <ScanFace className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
                {busy ? "Look at your phone…" : "Connect with Face ID"}
              </button>

              <ul className="text-small mt-11 grid gap-3.5 text-ink-muted">
                <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
                  The chat can never move your money. Every transfer is approved here, by your face.
                </Assurance>
                <Assurance icon={<MessageCircle className="size-[18px]" strokeWidth={2} />}>
                  If someone else ever got into your chat, they still could not spend a penny.
                </Assurance>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

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
