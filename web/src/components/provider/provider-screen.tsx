"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert, Copy, Check, Landmark, ShieldCheck, Wallet } from "lucide-react";

import { Assurance, Notice, Screen } from "@/components/sender/screen";
import { spring } from "@/lib/motion";
import { AUSD_DECIMALS, blocksToSeconds, client } from "@/lib/provider/chain";
import {
  approveStake,
  commitBid,
  headroom,
  markPaid,
  readAllowance,
  readCollateralBps,
  readStanding,
  revealBid,
  stake,
  type Standing,
} from "@/lib/provider/registry";
import {
  bidFor,
  canRememberBids,
  commitmentFor,
  markRevealed,
  pendingReveals,
  randomSalt,
  readOpenRequests,
  rememberBid,
  type Request,
} from "@/lib/provider/requests";
import { resumeWallet, walletClientFor, WalletError } from "@/lib/account/wallet";
import { WalletPicker } from "@/components/connect/wallet-picker";

/**
 * The provider's page.
 *
 * Seven things happen on this screen, in the order the protocol does them: connect, stake, see
 * requests, bid sealed, reveal, collect the account number, confirm payment. A bot does the same
 * seven calls; this exists so that somebody who holds naira and a bank account does not have to be
 * a bot to take part.
 *
 * Rail never holds a provider's key and cannot bid, pay or confirm for them. Every button here is
 * their own wallet acting for itself.
 */

const usd = (units: bigint): string => `$${Number(formatUnits(units, AUSD_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localAmount = (minor: bigint, currency: string): string =>
  `${currency} ${(Number(minor) / 100).toLocaleString()}`;

const seconds = (blocks: bigint): string => {
  const total = Math.max(0, Math.round(blocksToSeconds(blocks)));
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
};

type PayoutDetails = {
  bankName?: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  localAmount: string;
  narration: string;
};

const relayerBase = (process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:8787").replace(/\/+$/, "");

export function ProviderScreen() {
  const reduce = useReducedMotion();

  const [lp, setLp] = useState<Address | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [collateralBps, setCollateralBps] = useState<bigint>(11_000n);
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [stakeInput, setStakeInput] = useState("200");
  const [bidInputs, setBidInputs] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, PayoutDetails>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const storageWorks = useMemo(() => canRememberBids(), []);

  const refresh = useCallback(async (who: Address) => {
    const [next, bps, open] = await Promise.all([
      readStanding(who),
      readCollateralBps().catch(() => 11_000n),
      readOpenRequests().catch(() => []),
    ]);
    setStanding(next);
    setCollateralBps(bps);
    setRequests(open);
  }, []);

  useEffect(() => {
    void resumeWallet().then((wallet) => {
      if (!wallet) return;
      setLp(wallet.address);
      void refresh(wallet.address);
    });
  }, [refresh]);

  // Requests expire in blocks, so the list is stale within seconds of arriving.
  useEffect(() => {
    if (!lp) return;
    const timer = setInterval(() => void refresh(lp), 3_000);
    return () => clearInterval(timer);
  }, [lp, refresh]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    setNote(null);
    try {
      await work();
    } catch (error) {
      const message =
        error instanceof WalletError
          ? error.message
          : error instanceof Error
            ? error.message.split("\n")[0]
            : "That did not work.";
      setProblem(message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const doStake = () =>
    run("stake", async () => {
      if (!lp) return;
      const amount = parseUnits(stakeInput || "0", AUSD_DECIMALS);
      if (amount <= 0n) throw new Error("Enter an amount to stake.");

      const wallet = walletClientFor((await resumeWallet())!);
      // Approve only what is being staked. An open allowance is one somebody eventually spends.
      if ((await readAllowance(lp)) < amount) {
        const approval = await approveStake(wallet, lp, amount);
        await client.waitForTransactionReceipt({ hash: approval });
      }
      const hash = await stake(wallet, lp, amount);
      await client.waitForTransactionReceipt({ hash });
      setNote(`Staked ${usd(amount)}.`);
      await refresh(lp);
    });

  const doCommit = (request: Request) =>
    run(`commit:${request.orderId}`, async () => {
      if (!lp) return;
      if (!storageWorks) {
        throw new Error(
          "This browser will not let Rail remember your bid, and a sealed bid you cannot reveal locks your collateral for nothing. Turn on site storage first.",
        );
      }

      const amount = parseUnits(bidInputs[request.orderId] || "0", AUSD_DECIMALS);
      if (amount <= 0n) throw new Error("Enter your price.");
      if (amount > request.ceilingUnits) {
        throw new Error(`Above the sender's limit of ${usd(request.ceilingUnits)}. It would be refused.`);
      }

      const salt = randomSalt();
      // Stored before the transaction, never after: a crash in between is a bid that cannot reveal.
      if (!rememberBid({ orderId: request.orderId, lp, amount: amount.toString(), salt })) {
        throw new Error("Could not save your bid locally, so it was not sent.");
      }

      const wallet = walletClientFor((await resumeWallet())!);
      const hash = await commitBid(wallet, lp, request.orderId, commitmentFor(request.orderId, lp, amount, salt));
      await client.waitForTransactionReceipt({ hash });
      setNote("Bid sealed. Reveal it when the window opens, or it does not count.");
      await refresh(lp);
    });

  const doReveal = (request: Request) =>
    run(`reveal:${request.orderId}`, async () => {
      if (!lp) return;
      const saved = bidFor(request.orderId, lp);
      if (!saved) throw new Error("No sealed bid for this request on this device.");

      const wallet = walletClientFor((await resumeWallet())!);
      const hash = await revealBid(wallet, lp, request.orderId, BigInt(saved.amount), saved.salt);
      await client.waitForTransactionReceipt({ hash });
      markRevealed(request.orderId, lp);
      setNote("Revealed. If you are lowest, collateral locks and the request is yours.");
      await refresh(lp);
    });

  const fetchDetails = (orderId: Hex) =>
    run(`details:${orderId}`, async () => {
      if (!lp) return;
      const wallet = walletClientFor((await resumeWallet())!);
      const issuedAt = Math.floor(Date.now() / 1000);

      // The relayer hands the account number only to the winner, proved by this signature.
      const signature = await wallet.signMessage({
        account: lp,
        message: `Rail payout details\norder: ${orderId}\nissuedAt: ${issuedAt}`,
      });

      const response = await fetch(`${relayerBase}/v1/orders/${orderId}/payout-details`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lp, issuedAt, signature }),
        signal: AbortSignal.timeout(15_000),
      });

      const body = (await response.json()) as PayoutDetails & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not get the account details.");
      setDetails((current) => ({ ...current, [orderId]: body }));
    });

  const confirmPaid = (orderId: Hex) =>
    run(`paid:${orderId}`, async () => {
      if (!lp) return;
      const wallet = walletClientFor((await resumeWallet())!);
      const hash = await markPaid(wallet, lp, orderId);
      await client.waitForTransactionReceipt({ hash });
      setNote("Confirmed. The sender has a short window to object, then the escrow pays you.");
      await refresh(lp);
    });

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // The value is on screen and selectable.
    }
  };

  const awaitingReveal = lp ? pendingReveals(lp) : [];

  if (!lp) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col justify-center py-12">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface text-accent shadow-[var(--clay-raise)]">
            <Wallet className="size-6" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <h1 className="text-h2 mt-6">
            Earn by delivering <span className="accent-serif text-accent">naira</span>.
          </h1>
          <p className="text-lead mt-4 text-ink-muted">
            Stake dollars, bid on transfers you want, pay from your own bank account, and collect
            your bid. No application, no approval, no account manager.
          </p>

          <dl className="clay mt-6 grid grid-cols-2 gap-4 p-5 text-small">
            <div>
              <dt className="text-ink-muted">Minimum stake</dt>
              <dd className="mt-1 text-[1.0625rem] font-semibold tabular-nums">$100</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Collateral per win</dt>
              <dd className="mt-1 text-[1.0625rem] font-semibold tabular-nums">110%</dd>
            </div>
            <div className="col-span-2">
              <dd className="text-ink-muted">
                Your stake is yours. It locks only while you are the leading bid, and unlocks the
                moment the payment is proven. Walking away from a transfer you won costs more than
                delivering it, which is exactly why a stranger can trust you with their money.
              </dd>
            </div>
          </dl>
          <div className="mt-9">
            <WalletPicker
              busy={busy !== null}
              label="Connect wallet"
              className="btn btn-primary clay-press w-full text-[1rem]"
              onConnected={(wallet) => {
                setProblem(null);
                setLp(wallet.address);
                void refresh(wallet.address);
              }}
              onError={(error) =>
                setProblem(
                  error instanceof WalletError ? error.message : "That wallet could not be connected.",
                )
              }
            />
          </div>

          <ul className="text-small mt-11 grid gap-3.5 text-ink-muted">
            <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
              Rail never holds your key and never moves your stake. Only you bid, and only you confirm
              a payment.
            </Assurance>
            <Assurance icon={<Landmark className="size-[18px]" strokeWidth={2} />}>
              You pay from your own bank, on your own licence. Rail never touches naira.
            </Assurance>
          </ul>

          {problem ? (
            <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="Could not connect">
              {problem}
            </Notice>
          ) : null}
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-1 flex-col py-10">
        <h1 className="text-h2">Provider</h1>
        <p className="text-small mt-1.5 font-mono text-ink-muted">
          {lp.slice(0, 6)}...{lp.slice(-4)}
        </p>

        {!storageWorks ? (
          <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="Bidding is disabled here">
            This browser will not let Rail remember a sealed bid. A bid you cannot reveal locks your
            collateral for nothing, so bidding stays off until site storage is allowed.
          </Notice>
        ) : null}

        <section className="clay mt-7 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-label text-ink-muted">Staked</p>
              <p className="figure mt-1 text-h3 tabular-nums">{standing ? usd(standing.staked) : <span className="skeleton" aria-label="Loading">$0.00</span>}</p>
            </div>
            <div>
              <p className="text-label text-ink-muted">Free to bid with</p>
              <p className="figure mt-1 text-h3 tabular-nums text-accent">
                {standing ? usd(standing.free) : <span className="skeleton" aria-label="Loading">$0.00</span>}
              </p>
            </div>
          </div>

          {standing ? (
            <p className="text-small mt-4 text-ink-muted">
              {standing.eligible
                ? `Enough to win up to ${usd(headroom(standing, collateralBps))} at once, because a leading bid locks ${Number(collateralBps) / 100}% of itself.`
                : `You need at least ${usd(standing.minStake)} staked before you can bid.`}
              {standing.locked > 0n ? ` ${usd(standing.locked)} is locked against bids you are leading.` : ""}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5">
              <span className="text-small font-semibold">Add to your stake</span>
              <input
                value={stakeInput}
                onChange={(event) => setStakeInput(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                className="h-11 w-36 rounded-[14px] bg-surface px-3 font-mono shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <button
              type="button"
              onClick={() => void doStake()}
              disabled={busy !== null}
              className="btn btn-secondary-paper clay-press h-11"
            >
              {busy === "stake" ? "Staking…" : "Stake"}
            </button>
          </div>

          {standing ? (
            <dl className="text-small mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-ink-muted">
              <div>
                <dt>Won</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{String(standing.stats.wins)}</dd>
              </div>
              <div>
                <dt>Delivered</dt>
                <dd className="mt-0.5 font-semibold text-ink tabular-nums">{String(standing.stats.settled)}</dd>
              </div>
              <div>
                <dt>Defaults</dt>
                <dd
                  className={`mt-0.5 font-semibold tabular-nums ${standing.stats.defaults > 0n ? "text-slash-text" : "text-ink"}`}
                >
                  {String(standing.stats.defaults)}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>

        {awaitingReveal.length > 0 ? (
          <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="You have a sealed bid to reveal">
            A sealed bid only counts once revealed. Reveal it in the window below, or the collateral
            stays locked and you win nothing.
          </Notice>
        ) : null}

        <h2 className="text-h3 mt-10">Open requests</h2>
        {requests === null ? (
          <p className="text-small mt-3 text-ink-muted" role="status">
            Reading the chain...
          </p>
        ) : requests.length === 0 ? (
          <div className="clay mt-3 p-5">
            <p className="text-body">Nothing open right now.</p>
            <p className="text-small mt-1.5 text-ink-muted">
              This list refreshes every few seconds. A request stays biddable for about half a minute.
            </p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            {requests.map((request) => {
              const saved = bidFor(request.orderId, lp);
              const detail = details[request.orderId];
              const committing = busy === `commit:${request.orderId}`;
              const revealing = busy === `reveal:${request.orderId}`;

              return (
                <motion.li
                  key={request.orderId}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.settle}
                  className="clay p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[1.0625rem] font-semibold tabular-nums">
                      {localAmount(request.localAmountMinor, request.currency)}
                    </p>
                    <span className="text-small text-ink-muted">
                      {request.phase === "commit" ? "Sealed bids" : "Reveal"} ends in{" "}
                      {seconds(request.blocksLeft)}
                    </span>
                  </div>
                  <p className="text-small mt-1 text-ink-muted tabular-nums">
                    Sender pays at most {usd(request.ceilingUnits)}
                  </p>

                  {request.phase === "commit" && !saved ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="grid gap-1.5">
                        <span className="text-small font-semibold">Your price in dollars</span>
                        <input
                          value={bidInputs[request.orderId] ?? ""}
                          onChange={(event) =>
                            setBidInputs((current) => ({
                              ...current,
                              [request.orderId]: event.target.value.replace(/[^\d.]/g, ""),
                            }))
                          }
                          inputMode="decimal"
                          placeholder={usd(request.ceilingUnits).replace("$", "")}
                          className="h-11 w-32 rounded-[14px] bg-surface px-3 font-mono shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void doCommit(request)}
                        disabled={busy !== null || !storageWorks || !standing?.eligible}
                        className="btn btn-primary clay-press h-11"
                      >
                        {committing ? "Sealing…" : "Bid"}
                      </button>
                    </div>
                  ) : null}

                  {saved && !saved.revealed ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-small text-ink-muted tabular-nums">
                        Sealed at {usd(BigInt(saved.amount))}
                      </span>
                      <button
                        type="button"
                        onClick={() => void doReveal(request)}
                        disabled={busy !== null || request.phase !== "reveal"}
                        className="btn btn-primary clay-press h-11"
                      >
                        {revealing ? "Revealing…" : request.phase === "reveal" ? "Reveal" : "Waiting for reveal"}
                      </button>
                    </div>
                  ) : null}

                  {saved?.revealed ? (
                    <div className="mt-3">
                      {detail ? (
                        <div className="clay-press rounded-[14px] bg-paper p-3.5">
                          <p className="text-label text-ink-muted">Pay this account</p>
                          <p className="mt-1 font-semibold">{detail.accountName}</p>
                          <p className="text-small mt-0.5 text-ink-muted">
                            {detail.bankName ?? detail.bankCode} · {detail.accountNumber}
                          </p>
                          <p className="text-small mt-2 text-ink-muted">
                            Amount {detail.currency} {(Number(detail.localAmount) / 100).toLocaleString()}
                          </p>
                          <p className="text-small mt-2">
                            Reference{" "}
                            <span className="font-mono font-semibold">{detail.narration}</span>
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copy(detail.accountNumber, `acct:${request.orderId}`)}
                              className="btn btn-secondary-paper clay-press"
                            >
                              {copied === `acct:${request.orderId}` ? (
                                <Check className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
                              ) : (
                                <Copy className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
                              )}
                              Copy number
                            </button>
                            <button
                              type="button"
                              onClick={() => void confirmPaid(request.orderId)}
                              disabled={busy !== null}
                              className="btn btn-primary clay-press"
                            >
                              {busy === `paid:${request.orderId}` ? "Confirming…" : "I have paid"}
                            </button>
                          </div>
                          <p className="text-small mt-3 text-ink-muted">
                            Use that reference on the transfer. It is how the payment is matched to
                            this request, and how it is proved if anyone asks.
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void fetchDetails(request.orderId)}
                          disabled={busy !== null}
                          className="btn btn-primary clay-press"
                        >
                          {busy === `details:${request.orderId}` ? "Checking…" : "Show the account to pay"}
                        </button>
                      )}
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </ul>
        )}

        <AnimatePresence>
          {problem ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={spring.settle}
            >
              <Notice icon={<CircleAlert className="size-4" strokeWidth={2.2} />} title="That did not go through">
                {problem}
              </Notice>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {note ? <p className="text-small mt-4 text-accent">{note}</p> : null}
      </div>
    </Screen>
  );
}
