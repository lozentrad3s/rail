"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Clock, PiggyBank, Send } from "lucide-react";

import { ngn, usd } from "@/lib/format";
import { spring } from "@/lib/motion";
import { corridors } from "@/lib/site";
import { readHistory, type Totals, type Transfer } from "@/lib/account/history";

/**
 * What this account has done.
 *
 * The headline is not the balance, it is what the auction gave back. A sender sets a ceiling,
 * providers undercut each other below it, and the difference returns. That number is the product
 * working, so it gets the biggest type on the screen after the balance itself.
 *
 * Surfaces are clay, not glass: docs/DESIGN.md §5.1. Nothing here floats over moving content, and
 * a phone should not be asked to blur a dashboard it has to scroll.
 */

const minorToUnit = (minor: bigint): number => Number(minor) / 100;
const unitsToDollars = (units: bigint): number => Number(units) / 1_000_000;

function Figure({
  label,
  value,
  hint,
  icon,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "ink" | "accent";
}) {
  return (
    <div className="clay p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-label text-ink-muted">{label}</p>
        <span className="shrink-0 text-ink-muted" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p
        className={`figure mt-3 text-[clamp(1.5rem,1.1rem+1.4vw,2.125rem)] leading-none tracking-[-0.03em] tabular-nums ${
          tone === "accent" ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-small mt-2 text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function StatusPill({ status }: { status: Transfer["status"] }) {
  const copy = { running: "On its way", delivered: "Delivered", returned: "Returned to you" }[status];
  const tint = {
    running: "text-ink-muted",
    delivered: "text-accent",
    returned: "text-slash-text",
  }[status];
  return <span className={`text-small font-semibold ${tint}`}>{copy}</span>;
}

export function Dashboard({ address }: { address: `0x${string}` | undefined }) {
  const reduce = useReducedMotion();
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    readHistory(address)
      .then((history) => {
        if (cancelled) return;
        setTransfers(history.transfers);
        setTotals(history.totals);
        setPartial(history.partial);
      })
      .catch(() => {
        if (!cancelled) setTransfers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  const planned = useMemo(() => corridors.filter((corridor) => !corridor.live), []);

  if (!address) return null;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.settle}
      className="mt-10"
      aria-label="Your activity"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Figure
          label="Given back by the auction"
          value={totals ? usd(unitsToDollars(totals.returnedUnits)) : "..."}
          hint="Providers bid under your limit. The difference is yours."
          icon={<PiggyBank className="size-[18px]" strokeWidth={2} />}
          tone="accent"
        />
        <Figure
          label="Delivered"
          value={totals ? ngn(minorToUnit(totals.deliveredLocalMinor)) : "..."}
          hint={
            totals
              ? `${totals.delivered} transfer${totals.delivered === 1 ? "" : "s"} arrived`
              : undefined
          }
          icon={<Send className="size-[18px]" strokeWidth={2} />}
        />
        <Figure
          label="Paid out"
          value={totals ? usd(unitsToDollars(totals.spentUnits)) : "..."}
          hint="What the transfers and fees actually cost."
          icon={<ArrowUpRight className="size-[18px]" strokeWidth={2} />}
        />
        <Figure
          label="Still running"
          value={totals ? String(totals.running) : "..."}
          hint={totals && totals.running > 0 ? "We will tell you in the chat." : "Nothing in flight."}
          icon={<Clock className="size-[18px]" strokeWidth={2} />}
        />
      </div>

      {partial ? (
        <p className="text-small mt-3 text-ink-muted">
          Showing your recent transfers. Older ones are on the way.
        </p>
      ) : null}

      <h2 className="text-h3 mt-10">Recent transfers</h2>

      {transfers === null ? (
        <p className="text-small mt-4 text-ink-muted" role="status">
          Reading your history...
        </p>
      ) : transfers.length === 0 ? (
        <div className="clay mt-4 p-5">
          <p className="text-body">You have not sent anything yet.</p>
          <p className="text-small mt-1.5 text-ink-muted">
            Say <span className="font-semibold text-ink">send 50k to mum</span> in the chat and it
            will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-2.5">
          {transfers.map((transfer, index) => (
            <motion.li
              key={transfer.orderId}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.settle, delay: reduce ? 0 : Math.min(index * 0.03, 0.2) }}
              className="clay p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[1.0625rem] font-semibold tabular-nums">
                  {transfer.currency === "NGN"
                    ? ngn(minorToUnit(transfer.localAmountMinor))
                    : `${transfer.currency} ${minorToUnit(transfer.localAmountMinor).toLocaleString()}`}
                </p>
                <StatusPill status={transfer.status} />
              </div>
              <div className="text-small mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
                {transfer.status === "delivered" ? (
                  <>
                    <span className="tabular-nums">
                      Cost {usd(unitsToDollars((transfer.paidUnits ?? 0n) + transfer.feeUnits))}
                    </span>
                    {transfer.returnedUnits && transfer.returnedUnits > 0n ? (
                      <span className="inline-flex items-center gap-1 text-accent tabular-nums">
                        <ArrowDownLeft className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
                        {usd(unitsToDollars(transfer.returnedUnits))} back
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="tabular-nums">
                    Up to {usd(unitsToDollars(transfer.ceilingUnits + transfer.feeUnits))}
                  </span>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      <h2 className="text-h3 mt-10">Where you can send</h2>
      <div className="clay mt-4 p-5">
        <p className="text-body">
          <span className="font-semibold">Nigeria</span> is live, from the UK and US.
        </p>
        <p className="text-small mt-2 text-ink-muted">
          The auction does not care where money lands. Any provider holding the local currency can
          bid, so these are next as providers join:
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {planned.map((corridor) => (
            <li
              key={corridor.to}
              className="text-small rounded-chip bg-paper px-2.5 py-1 text-ink-muted"
            >
              {corridor.to}
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}
