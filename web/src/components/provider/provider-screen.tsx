"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell, BellOff, CircleAlert, Copy, Check, Landmark, LogOut, ShieldCheck, Wallet } from "lucide-react";

import { Assurance, Notice, Screen } from "@/components/sender/screen";
import { spring } from "@/lib/motion";
import { auction } from "@/lib/site";
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
  readWins,
  rememberBid,
  type Request,
  type Win,
} from "@/lib/provider/requests";
import { forgetWallet, resumeWallet, WalletError } from "@/lib/account/wallet";
import { browserAccount, type ProviderAccount } from "@/lib/provider/account";
import { WalletPicker } from "@/components/connect/wallet-picker";
import {
  DYNAMIC_ENVIRONMENT_ID,
  DynamicAccountBridge,
  DynamicSignInButton,
} from "@/components/provider/dynamic-sign-in";
import { WalletBalances, type Holdings } from "@/components/connect/wallet-balances";

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

/** The two EIP-1193 events this page follows. Every wallet emits them; viem's type omits `on`. */
type WalletEvents = {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

const relayerBase = (process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:8787").replace(/\/+$/, "");

/** Small per-device preferences. Storage can be refused; every read has a default. */
function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that does not stick is a preference asked again, nothing worse.
  }
}
const MARGIN_KEY = "rail.provider.margin.v1";
const ALERTS_KEY = "rail.provider.alerts.v1";
const AUTO_REVEAL_KEY = "rail.provider.autoreveal.v1";
const AUTO_BID_KEY = "rail.provider.autobid.v1";

/** A short two-note chime. Browsers only allow sound after a tap, which turning alerts on is. */
function chime(context: AudioContext | null): void {
  if (!context) return;
  for (const [offset, frequency] of [
    [0, 880],
    [0.16, 1320],
  ] as const) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.32);
  }
}

/** Dollars to the cent, rounded down so a suggestion never lands a cent above the ceiling. */
const centsText = (units: bigint): string => formatUnits(units - (units % 10_000n), AUSD_DECIMALS);

export function ProviderScreen() {
  const reduce = useReducedMotion();

  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const lp = account?.address ?? null;
  const [standing, setStanding] = useState<Standing | null>(null);
  const [collateralBps, setCollateralBps] = useState<bigint>(11_000n);
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [stakeInput, setStakeInput] = useState("200");
  const [bidInputs, setBidInputs] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, PayoutDetails>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const [wins, setWins] = useState<Win[]>([]);
  /** The live quote for each request, in AUSD units: what the market says it costs to deliver. */
  const [quotes, setQuotes] = useState<Record<string, bigint>>({});
  const [marginPct, setMarginPct] = useState<string>(() => readPref(MARGIN_KEY) ?? "1");
  const [alertsOn, setAlertsOn] = useState<boolean>(() => readPref(ALERTS_KEY) === "on");
  const [autoReveal, setAutoReveal] = useState<boolean>(() => readPref(AUTO_REVEAL_KEY) !== "off");
  const [autoBid, setAutoBid] = useState<boolean>(() => readPref(AUTO_BID_KEY) === "on");

  /** Requests already announced. Null until the first read, so opening the page does not chime. */
  const seen = useRef<Set<string> | null>(null);
  const quoted = useRef(new Set<string>());
  const alertsRef = useRef(alertsOn);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    alertsRef.current = alertsOn;
  }, [alertsOn]);

  const storageWorks = useMemo(() => canRememberBids(), []);

  const refresh = useCallback(async (who: Address) => {
    const [next, bps, open, won] = await Promise.all([
      readStanding(who),
      readCollateralBps().catch(() => 11_000n),
      readOpenRequests().catch(() => []),
      readWins(who).catch(() => []),
    ]);
    setStanding(next);
    setCollateralBps(bps);
    setRequests(open);
    setWins(won);

    // A request nobody has seen yet: say so, out loud and on the lock screen, if asked to.
    const fresh = open.filter((request) => request.phase === "commit" && !seen.current?.has(request.orderId));
    if (seen.current && alertsRef.current && fresh.length > 0) {
      chime(audio.current);
      if ("Notification" in window && Notification.permission === "granted") {
        for (const request of fresh) {
          new Notification("New transfer to deliver", {
            body: `${localAmount(request.localAmountMinor, request.currency)} · sender pays up to ${usd(request.ceilingUnits)} · bids close in ${seconds(request.blocksLeft)}`,
            tag: request.orderId,
          });
        }
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...open.map((request) => request.orderId)]);

    // The market's price for each new request, so a provider can bid in one tap.
    for (const request of open) {
      if (request.phase !== "commit" || quoted.current.has(request.orderId)) continue;
      quoted.current.add(request.orderId);
      void fetch(
        `${relayerBase}/v1/quote?currency=${request.currency}&localAmount=${request.localAmountMinor}`,
        { signal: AbortSignal.timeout(8_000) },
      )
        .then((response) => (response.ok ? (response.json() as Promise<{ indicativeAusd?: string }>) : undefined))
        .then((quote) => {
          if (quote?.indicativeAusd) {
            setQuotes((current) => ({ ...current, [request.orderId]: BigInt(quote.indicativeAusd!) }));
          }
        })
        .catch(() => quoted.current.delete(request.orderId));
    }
  }, []);

  // Browsers only play sound after a gesture; the first tap anywhere unlocks it for this visit.
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        // No audio here; notifications still work.
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    void resumeWallet().then((wallet) => {
      if (!wallet) return;
      setAccount((current) => current ?? browserAccount(wallet));
      void refresh(wallet.address);
    });
  }, [refresh]);

  /**
   * Dynamic reports its wallet here. Signing out of Dynamic clears only a Dynamic account, never a
   * browser wallet connected through the other door.
   */
  const onDynamic = useCallback(
    (next: ProviderAccount | null) => {
      setAccount((current) => (next ? next : current?.source === "dynamic" ? null : current));
      if (next) void refresh(next.address);
    },
    [refresh],
  );

  /**
   * Follow the wallet rather than a snapshot of it. Switching account in Zerion or MetaMask used to
   * leave this page bidding as the old address until a reload.
   */
  useEffect(() => {
    // Dynamic follows its own wallet's account changes; this is for the browser picker only.
    if (!lp || account?.source !== "browser") return;
    let detach: (() => void) | undefined;
    let cancelled = false;
    void resumeWallet().then((wallet) => {
      const provider = wallet?.provider as unknown as WalletEvents | undefined;
      if (cancelled || !provider?.on) return;
      const onAccounts = (...args: unknown[]) => {
        const next = (args[0] as string[] | undefined)?.[0] as Address | undefined;
        if (!next) {
          forgetWallet();
          setAccount(null);
          return;
        }
        if (wallet) setAccount(browserAccount({ ...wallet, address: next }));
        setStanding(null);
        void refresh(next);
      };
      const onChain = () => void refresh(lp);
      provider.on("accountsChanged", onAccounts);
      provider.on("chainChanged", onChain);
      detach = () => {
        provider.removeListener?.("accountsChanged", onAccounts);
        provider.removeListener?.("chainChanged", onChain);
      };
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [lp, account?.source, refresh]);

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

      if (!account) return;
      const wallet = await account.walletClient();
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

  /** The live quote plus this provider's margin, capped at what the sender will pay. */
  const suggestedFor = (request: Request): bigint | undefined => {
    const quote = quotes[request.orderId];
    const pct = Number(marginPct);
    if (quote === undefined || !Number.isFinite(pct) || pct < 0 || pct > 50) return undefined;
    const price = (quote * (10_000n + BigInt(Math.round(pct * 100)))) / 10_000n;
    return price > request.ceilingUnits ? request.ceilingUnits : price;
  };
  const priceText = (request: Request): string => {
    const typed = bidInputs[request.orderId];
    if (typed !== undefined) return typed;
    const suggested = suggestedFor(request);
    return suggested === undefined ? "" : centsText(suggested);
  };

  const toggleAlerts = async () => {
    if (alertsOn) {
      setAlertsOn(false);
      writePref(ALERTS_KEY, "off");
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
    } catch {
      // Sound is a nicety; the notification is the alert.
    }
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => "denied");
    }
    setAlertsOn(true);
    writePref(ALERTS_KEY, "on");
    chime(audio.current);
  };

  const doCommit = (request: Request) =>
    run(`commit:${request.orderId}`, async () => {
      if (!lp) return;
      if (!storageWorks) {
        throw new Error(
          "This browser will not let Rail remember your bid, and a sealed bid you cannot reveal locks your collateral for nothing. Turn on site storage first.",
        );
      }

      const amount = parseUnits(priceText(request) || "0", AUSD_DECIMALS);
      if (amount <= 0n) throw new Error("Enter your price.");
      if (amount > request.ceilingUnits) {
        throw new Error(`Above the sender's limit of ${usd(request.ceilingUnits)}. It would be refused.`);
      }

      const salt = randomSalt();
      // Stored before the transaction, never after: a crash in between is a bid that cannot reveal.
      if (!rememberBid({ orderId: request.orderId, lp, amount: amount.toString(), salt })) {
        throw new Error("Could not save your bid locally, so it was not sent.");
      }

      if (!account) return;
      const wallet = await account.walletClient();
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

      if (!account) return;
      const wallet = await account.walletClient();
      const hash = await revealBid(wallet, lp, request.orderId, BigInt(saved.amount), saved.salt);
      await client.waitForTransactionReceipt({ hash });
      markRevealed(request.orderId, lp);
      setNote("Revealed. If you are lowest, collateral locks and the request is yours.");
      await refresh(lp);
    });

  /**
   * Reveal without being asked, on the device that holds the salt. A sealed bid that is never
   * revealed wins nothing and locks collateral, and the reveal window opens while a person may well
   * be looking at something else. Tried once per bid; the button stays for a retry.
   */
  const revealRef = useRef(doReveal);
  useEffect(() => {
    revealRef.current = doReveal;
  });
  const revealTried = useRef(new Set<string>());
  useEffect(() => {
    if (!lp || !autoReveal || busy !== null || !requests) return;
    const due = requests.find((request) => {
      if (request.phase !== "reveal" || revealTried.current.has(request.orderId)) return false;
      const saved = bidFor(request.orderId, lp);
      return saved !== undefined && !saved.revealed;
    });
    if (!due) return;
    revealTried.current.add(due.orderId);
    void revealRef.current(due);
  }, [requests, lp, autoReveal, busy]);

  /**
   * Autopilot: bid at the provider's own margin the moment a request arrives, and fetch the account
   * to pay the moment a win is confirmed. Every action is still the provider's wallet signing for
   * itself — a connected wallet asks once per signature — because a bid can only come from the key
   * that staked. Nothing here can spend anything but the provider's own stake on their own bids.
   */
  const commitRef = useRef(doCommit);
  const detailsRef = useRef<(orderId: Hex) => Promise<void>>(async () => {});
  useEffect(() => {
    commitRef.current = doCommit;
  });
  const bidTried = useRef(new Set<string>());
  const detailsTried = useRef(new Set<string>());
  useEffect(() => {
    if (!lp || !autoBid || busy !== null || !requests || !standing?.eligible) return;
    const next = requests.find(
      (request) =>
        request.phase === "commit" &&
        request.blocksLeft > 15n &&
        !bidTried.current.has(request.orderId) &&
        !bidFor(request.orderId, lp) &&
        suggestedFor(request) !== undefined &&
        // Only what the free stake can collateralise: a win it cannot lock is a reveal that fails.
        (standing ? (suggestedFor(request)! * collateralBps) / 10_000n <= standing.free : false),
    );
    if (next) {
      bidTried.current.add(next.orderId);
      void commitRef.current(next);
      return;
    }
    const owed = wins.find((win) => win.stage === "pay" && !details[win.orderId] && !detailsTried.current.has(win.orderId));
    if (owed) {
      detailsTried.current.add(owed.orderId);
      void detailsRef.current(owed.orderId);
    }
  });

  const fetchDetails = (orderId: Hex) =>
    run(`details:${orderId}`, async () => {
      if (!lp) return;
      if (!account) return;
      const wallet = await account.walletClient();
      const issuedAt = Math.floor(Date.now() / 1000);

      // The relayer hands the account number only to the winner, proved by this signature.
      const signature = await wallet.signMessage({
        account: wallet.account ?? lp,
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

  useEffect(() => {
    detailsRef.current = fetchDetails;
  });

  const confirmPaid = (orderId: Hex) =>
    run(`paid:${orderId}`, async () => {
      if (!lp) return;
      if (!account) return;
      const wallet = await account.walletClient();
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

  /**
   * Where this provider is in onboarding. Derived from the chain every time, never stored: a step is
   * done because the wallet shows it done, not because a button was pressed on this device.
   */
  const minStake = standing?.minStake ?? 100_000_000n;
  const staked = standing?.eligible === true;
  const funded =
    staked ||
    (holdings !== null && holdings.monWei > 0n && holdings.ausdUnits + (standing?.staked ?? 0n) >= minStake);
  const step: 1 | 2 | 3 | 4 = !lp ? 1 : !funded ? 2 : !staked ? 3 : 4;

  const bridge = DYNAMIC_ENVIRONMENT_ID ? <DynamicAccountBridge onChange={onDynamic} /> : null;

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
          <Steps current={1} />

          {bridge}
          <div className="mt-7">
            {DYNAMIC_ENVIRONMENT_ID ? (
              <>
                <DynamicSignInButton disabled={busy !== null} />
                <p className="text-small mt-2 text-ink-muted">
                  Use a browser wallet, a wallet on your phone, or just your email. Sign-in is by
                  Dynamic; Rail never sees your key.
                </p>
              </>
            ) : null}
            <WalletPicker
              busy={busy !== null}
              hideWhenNone={Boolean(DYNAMIC_ENVIRONMENT_ID)}
              heading={
                DYNAMIC_ENVIRONMENT_ID ? (
                  <p className="text-label mb-2 mt-6 text-ink-muted">Or connect a browser wallet directly</p>
                ) : undefined
              }
              label="Connect wallet"
              className={
                DYNAMIC_ENVIRONMENT_ID
                  ? "btn btn-secondary-paper clay-press w-full text-[1rem]"
                  : "btn btn-primary clay-press w-full text-[1rem]"
              }
              onConnected={(wallet) => {
                setProblem(null);
                setAccount(browserAccount(wallet));
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
            <Assurance icon={<Wallet className="size-[18px]" strokeWidth={2} />}>
              Your wallet will ask to switch to Monad Testnet, and to add it if it has not seen it
              before. That is expected during the pilot: it is where the test dollars live.
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
      {bridge}
      <div className="flex flex-1 flex-col py-10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h2">Provider</h1>
            <p className="text-small mt-1.5 font-mono text-ink-muted">
              {lp.slice(0, 6)}...{lp.slice(-4)}
              <span className="ml-2 font-sans">
                · {account?.source === "dynamic" ? `${account.label} via Dynamic` : account?.label}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void account?.signOut();
              setAccount(null);
              setStanding(null);
              setHoldings(null);
            }}
            className="btn btn-sm btn-secondary-paper clay-press"
          >
            <LogOut className="size-4" strokeWidth={2.2} aria-hidden="true" />
            Disconnect
          </button>
        </div>

        <Steps current={step} />

        {step < 4 ? (
          <div className="clay mt-6 p-5">
            <p className="text-label text-accent">Step {step} of 4</p>
            <p className="mt-1.5 font-semibold">
              {step === 2 ? "Fund your wallet" : `Stake at least ${usd(minStake)}`}
            </p>
            <p className="text-small mt-1.5 text-ink-muted">
              {step === 2
                ? `You need at least ${usd(minStake)} in AUSD to stake, and a little MON for network fees. Both are free on the test network: use the buttons below.`
                : "Stake is your collateral. It locks only while you lead an auction, and unlocks the moment your payment is proven. Walking away from a win costs more than delivering it, which is why a stranger can trust you."}
            </p>
          </div>
        ) : null}

        <WalletBalances address={lp} needsGas onChange={setHoldings} />

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
            {autoReveal
              ? "It reveals by itself when the window opens: keep this page open and approve the prompt."
              : "A sealed bid only counts once revealed. Reveal it in the window below, or it wins nothing."}
          </Notice>
        ) : null}

        {wins.length > 0 ? (
          <>
            <h2 className="text-h3 mt-10">Your wins</h2>
            <ul className="mt-3 grid gap-2.5">
              {wins.map((win) => {
                const detail = details[win.orderId];
                return (
                  <li key={win.orderId} className={`clay p-4 ${win.stage === "pay" ? "ring-2 ring-accent" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[1.0625rem] font-semibold tabular-nums">
                        {localAmount(win.localAmountMinor, win.currency)}
                      </p>
                      <span className="text-small font-semibold text-accent tabular-nums">You earn {usd(win.bidUnits)}</span>
                    </div>
                    {win.stage === "pay" ? (
                      <>
                        <p className="text-small mt-1 text-ink-muted">
                          You won this transfer. Pay it from your bank, then confirm.
                          {win.blocksToPay > 0n ? ` About ${seconds(win.blocksToPay)} left to pay.` : ""}
                        </p>
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
                                Reference <span className="font-mono font-semibold">{detail.narration}</span>
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void copy(detail.accountNumber, `acct:${win.orderId}`)}
                                  className="btn btn-secondary-paper clay-press"
                                >
                                  {copied === `acct:${win.orderId}` ? (
                                    <Check className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
                                  ) : (
                                    <Copy className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
                                  )}
                                  Copy number
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void confirmPaid(win.orderId)}
                                  disabled={busy !== null}
                                  className="btn btn-primary clay-press"
                                >
                                  {busy === `paid:${win.orderId}` ? "Confirming…" : "I have paid"}
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
                              onClick={() => void fetchDetails(win.orderId)}
                              disabled={busy !== null}
                              className="btn btn-primary clay-press"
                            >
                              {busy === `details:${win.orderId}` ? "Checking…" : "Show the account to pay"}
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-small mt-1 text-ink-muted">
                        {win.stage === "paid"
                          ? "Marked paid. Your bid arrives once the payment is verified, or when the sender's window to object closes."
                          : "Settled. Your bid is in your wallet and your collateral is free again."}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        <h2 className="text-h3 mt-10">Open requests</h2>
        {!staked ? (
          <p className="text-small mt-2 text-ink-muted">
            You can watch requests now; bidding opens once you have staked. Each one runs the same way:
            seal a price while bids are open, reveal it when reveals open, and if yours is lowest it
            moves to Your wins with the account to pay. Pay it from your bank with the reference shown,
            tap &ldquo;I have paid&rdquo;, and your bid lands in this wallet.
          </p>
        ) : null}

        {/* Set once, used on every request: what makes bidding one tap instead of arithmetic. */}
        <div className="clay mt-3 grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-small">
              <span className="font-semibold">Your margin over market</span>
              <input
                value={marginPct}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^\d.]/g, "");
                  setMarginPct(next);
                  writePref(MARGIN_KEY, next);
                }}
                inputMode="decimal"
                aria-label="Your margin over the market rate, in percent"
                className="h-9 w-16 rounded-[12px] bg-surface px-2 text-center font-mono shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span>%</span>
            </label>
            <button type="button" onClick={() => void toggleAlerts()} className="btn btn-sm btn-secondary-paper clay-press">
              {alertsOn ? (
                <Bell className="size-4" strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <BellOff className="size-4" strokeWidth={2.2} aria-hidden="true" />
              )}
              {alertsOn ? "Alerts on" : "Turn on alerts"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={autoBid}
              onChange={(event) => {
                setAutoBid(event.target.checked);
                writePref(AUTO_BID_KEY, event.target.checked ? "on" : "off");
              }}
              className="size-4 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-semibold">Autopilot:</span> bid at my margin as requests arrive, and show
              me the account to pay when I win
            </span>
          </label>
          <label className="flex items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={autoReveal}
              onChange={(event) => {
                setAutoReveal(event.target.checked);
                writePref(AUTO_REVEAL_KEY, event.target.checked ? "on" : "off");
              }}
              className="size-4 accent-[var(--color-accent)]"
            />
            Reveal my sealed bids automatically
          </label>
          <p className="text-small text-ink-muted">
            Away from this page? Say <span className="font-semibold text-ink">alerts</span> to{" "}
            <a href="https://t.me/RailpayBot" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              @RailpayBot
            </a>{" "}
            on Telegram and every new request comes to you there. Want it bidding around the clock with
            no prompts?{" "}
            <a
              href="https://github.com/lozentrad3s/rail/tree/main/services/matcher#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Run your own bidding bot
            </a>
            .
          </p>
        </div>

        {requests === null ? (
          <p className="text-small mt-3 text-ink-muted" role="status">
            Reading the chain...
          </p>
        ) : requests.length === 0 ? (
          <div className="clay mt-3 p-5">
            <p className="text-body">Nothing open right now.</p>
            <p className="text-small mt-1.5 text-ink-muted">
              This list refreshes every few seconds{alertsOn ? ", and chimes when a request arrives" : ""}. Sealed
              bids stay open for about {auction.commitSeconds} seconds, then reveals for another{" "}
              {auction.revealSeconds}.
            </p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2.5">
            {requests.map((request) => {
              const saved = bidFor(request.orderId, lp);
              const committing = busy === `commit:${request.orderId}`;
              const revealing = busy === `reveal:${request.orderId}`;
              const suggested = suggestedFor(request);
              const price = priceText(request);

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
                      {request.phase === "commit" ? "Sealed bids close" : "Reveals close"} in{" "}
                      {seconds(request.blocksLeft)}
                    </span>
                  </div>
                  <p className="text-small mt-1 text-ink-muted tabular-nums">
                    Sender pays at most {usd(request.ceilingUnits)}
                    {suggested !== undefined && quotes[request.orderId] !== undefined
                      ? ` · market ${usd(quotes[request.orderId]!)}`
                      : ""}
                  </p>

                  {request.phase === "commit" && !saved ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="grid gap-1.5">
                        <span className="text-small font-semibold">Your price in dollars</span>
                        <input
                          value={price}
                          onChange={(event) =>
                            setBidInputs((current) => ({
                              ...current,
                              [request.orderId]: event.target.value.replace(/[^\d.]/g, ""),
                            }))
                          }
                          inputMode="decimal"
                          placeholder={centsText(request.ceilingUnits)}
                          className="h-11 w-32 rounded-[14px] bg-surface px-3 font-mono shadow-[var(--clay-raise)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void doCommit(request)}
                        disabled={busy !== null || !storageWorks || !standing?.eligible || !price}
                        className="btn btn-primary clay-press h-11"
                      >
                        {committing ? "Sealing…" : price ? `Bid $${price}` : "Bid"}
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
                        {revealing
                          ? "Revealing…"
                          : request.phase === "reveal"
                            ? "Reveal"
                            : autoReveal
                              ? "Reveals automatically"
                              : "Waiting for reveal"}
                      </button>
                    </div>
                  ) : null}

                  {saved?.revealed ? (
                    <p className="text-small mt-3 text-ink-muted tabular-nums">
                      Revealed at {usd(BigInt(saved.amount))}. If it is the lowest, this moves to Your wins
                      when reveals close, with the account to pay.
                    </p>
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

const STEPS = ["Connect", "Fund", "Stake", "Bid"] as const;

/** Four steps, the same four every provider takes, in the order the protocol needs them. */
function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="mt-7 grid grid-cols-4 gap-2" aria-label="Getting started">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const done = n < current;
        const now = n === current;
        return (
          <li key={label} aria-current={now ? "step" : undefined} className="grid gap-1.5">
            <span
              className={`h-1.5 rounded-full ${done ? "bg-accent" : now ? "bg-accent/50" : "bg-line"}`}
              aria-hidden="true"
            />
            <span className={`text-small ${now ? "font-semibold text-ink" : "text-ink-muted"}`}>
              {done ? <Check className="mr-1 inline size-3.5 text-accent" strokeWidth={2.6} aria-hidden="true" /> : null}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
