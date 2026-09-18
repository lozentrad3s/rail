"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
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
      "Open Rail in Safari on iPhone, or in Chrome signed in to Google Password Manager, and try again.",
  },
  cancelled: {
    title: "Face ID was cancelled",
    detail: "Nothing was created. Tap again when you're ready.",
  },
  "host-not-allowed": {
    title: "Accounts are only created on the live Rail site",
    detail: "This is a preview address. Your account would not work anywhere else.",
  },
  unknown: {
    title: "That didn't work",
    detail: "Please try again. If it keeps happening, nothing has been created or charged.",
  },
};

export function StartScreen() {
  const router = useRouter();
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
    <Screen>
      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-h2">
          Your money, <span className="accent-serif text-accent">yours alone</span>.
        </h1>
        <p className="text-lead mt-4 text-ink-muted">
          Set up your account with Face ID. No password, nothing to write down, nothing to lose.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => run("create")}
            disabled={busy !== null}
            aria-disabled={busy !== null}
            className="btn btn-primary w-full"
          >
            <ScanFace className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
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
        </div>

        <AnimatePresence>
          {failure ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring.settle}
            >
              <Notice
                icon={<CircleAlert className="size-4" strokeWidth={2.2} />}
                title={FAILURES[failure].title}
              >
                {FAILURES[failure].detail}
              </Notice>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ul className="text-small mt-10 grid gap-3 text-ink-muted">
          <Assurance icon={<ShieldCheck className="size-4" strokeWidth={2} />}>
            Only your face can approve a transfer — not us, and not anyone who takes your phone.
          </Assurance>
          <Assurance icon={<Landmark className="size-4" strokeWidth={2} />}>
            Your family needs nothing but their normal bank account.
          </Assurance>
          <Assurance icon={<Sparkles className="size-4" strokeWidth={2} />}>
            Setting up is free, and takes one tap.
          </Assurance>
        </ul>
      </div>
    </Screen>
  );
}
