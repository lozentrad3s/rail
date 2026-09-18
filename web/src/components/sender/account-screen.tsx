"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Plus, RefreshCw, Send } from "lucide-react";
import { Notice, Screen } from "./screen";
import { cn, usd } from "@/lib/format";
import { readBalance } from "@/lib/account/chain";
import {
  accountSnapshot,
  forgetAccount,
  parseAccount,
  serverAccountSnapshot,
  subscribeAccount,
} from "@/lib/account/passkey";

export function AccountScreen() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeAccount, accountSnapshot, serverAccountSnapshot);
  const account = useMemo(() => parseAccount(raw), [raw]);
  const address = account?.address;

  const [dollars, setDollars] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);

  // A device with no account has nothing to show.
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
        const { dollars: amount } = await readBalance(address);
        if (!cancelled) {
          setDollars(amount);
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
  }, [address, reload]);

  if (!account) return null;

  return (
    <Screen>
      <div className="flex flex-1 flex-col pt-10">
        <div className="rounded-card bg-surface p-6 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-label text-ink-muted">Your balance</p>
            <button
              type="button"
              onClick={() => setReload((n) => n + 1)}
              className="press -m-2 rounded-lg p-2 text-ink-muted"
              aria-label="Check for money that has just arrived"
            >
              <RefreshCw className={cn("size-4", reading && "animate-spin")} strokeWidth={2.2} />
            </button>
          </div>
          <p className="figure mt-2 text-[2.5rem] leading-none tracking-[-0.02em]" aria-live="polite">
            {dollars === null ? "—" : usd(dollars)}
          </p>
          <p className="text-small mt-3 text-ink-muted">
            Held in dollars. Nobody can move it without your face.
          </p>
        </div>

        {unreachable ? (
          <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="Can't show your balance right now">
            Your money is safe — this is only the connection. Try again in a moment.
          </Notice>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <span
            role="link"
            aria-disabled="true"
            className="btn btn-secondary-paper"
            title="Adding money opens with the pilot"
          >
            <Plus className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
            Add money
          </span>
          <span
            role="link"
            aria-disabled="true"
            className="btn btn-secondary-paper"
            title="Sending opens with the pilot"
          >
            <Send className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
            Send
          </span>
        </div>
        <p className="text-small mt-3 text-ink-muted">
          Adding money and sending open with the pilot in October.
        </p>

        <div className="mt-10">
          <p className="text-label text-ink-muted">Transfers</p>
          <p className="text-small mt-2 text-ink-muted">Your transfers will appear here.</p>
        </div>

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
            className="text-small press rounded-lg text-ink-muted underline decoration-line underline-offset-4"
          >
            {confirmForget ? "Tap again to remove it from this phone" : "Remove this account from this phone"}
          </button>
          {confirmForget ? (
            <p className="text-small mt-2 text-ink-muted">
              Your money stays where it is. Face ID brings the account back.
            </p>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
