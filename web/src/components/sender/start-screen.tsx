"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, Landmark, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { Assurance, Notice, Screen } from "./screen";
import { spring } from "@/lib/motion";
import {
  AccountError,
  createAccount,
  loadAccount,
  restoreAccount,
  type AccountFailureReason,
} from "@/lib/account/passkey";

/** What each failure means for the person, in their words. Never a code, never a stack trace. */
const FAILURES: Record<AccountFailureReason, { title: string; detail: string }> = {
  "unsupported-passkey": {
    title: "This browser can't set up Face ID",
    detail:
      "Open Rail in Safari on iPhone, or in Chrome signed in to Google Password Manager. On a computer, choose “Use a phone or tablet” and scan the code.",
  },
  cancelled: {
    title: "Face ID was cancelled",
    detail: "Nothing was created. Tap again whenever you're ready.",
  },
  "host-not-allowed": {
    title: "Accounts are only set up on the live Rail site",
    detail: "This is a preview address, and an account made here would not work anywhere else.",
  },
  unknown: {
    title: "That didn't work",
    detail: "Please try again. Nothing has been created, and nothing has been charged.",
  },
};

export function StartScreen() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState<"create" | "restore" | null>(null);
  const [failure, setFailure] = useState<AccountFailureReason | null>(null);

  // A device that already holds an account goes straight to it. A host that must not mint passkeys
  // isn't checked here: `createAccount` refuses, and the person gets the same honest notice.
  useEffect(() => {
    if (loadAccount()) router.replace("/account");
  }, [router]);

  const run = async (kind: "create" | "restore") => {
    setBusy(kind);
    setFailure(null);
    try {
      if (kind === "create") await createAccount("Rail");
      else await restoreAccount();
      router.replace("/account");
    } catch (error) {
      setFailure(error instanceof AccountError ? error.reason : "unknown");
      setBusy(null);
    }
  };

  return (
    <Screen className="relative isolate">
      {/* One soft light source, placed where the eye should land — docs/DESIGN.md §2.1 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem]"
        style={{ background: "radial-gradient(90% 60% at 50% 0%, rgb(110 84 255 / 0.13), transparent 70%)" }}
      />

      <div className="flex flex-1 flex-col justify-center py-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.settle}
        >
          <h1 className="text-h2">
            Money that gets <span className="accent-serif text-accent">home</span>.
          </h1>
          <p className="text-lead mt-4 text-ink-muted">
            Set up your account with one look. No password, nothing to write down, nothing that can
            be phished out of you.
          </p>
        </motion.div>

        <div className="mt-9 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => run("create")}
            disabled={busy !== null}
            aria-disabled={busy !== null}
            className="btn btn-primary w-full text-[1rem]"
          >
            <ScanFace className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
            {busy === "create" ? "Look at your phone…" : "Set up with Face ID"}
          </button>

          <button
            type="button"
            onClick={() => run("restore")}
            disabled={busy !== null}
            aria-disabled={busy !== null}
            className="btn btn-secondary-paper w-full"
          >
            {busy === "restore" ? "Look at your phone…" : "I already have an account"}
          </button>

          {/*
           * The other door. Somebody who already keeps dollars somewhere has nothing to set up and
           * nothing to top up, and without this they land here with no way through.
           */}
          <button
            type="button"
            onClick={() => router.push("/connect")}
            disabled={busy !== null}
            className="btn btn-secondary-paper w-full"
          >
            Use an account I already have
          </button>
        </div>

        <AnimatePresence>
          {failure ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={spring.settle}
            >
              <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title={FAILURES[failure].title}>
                {FAILURES[failure].detail}
              </Notice>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ul className="text-small mt-11 grid gap-3.5 text-ink-muted">
          <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
            Only your face approves a transfer. Not us, and not anyone holding your phone.
          </Assurance>
          <Assurance icon={<Landmark className="size-[18px]" strokeWidth={2} />}>
            Your family needs nothing but their normal bank account.
          </Assurance>
          <Assurance icon={<Sparkles className="size-[18px]" strokeWidth={2} />}>
            Setting up is free and takes one tap.
          </Assurance>
        </ul>
      </div>
    </Screen>
  );
}
