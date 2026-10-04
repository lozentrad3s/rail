"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Wallet } from "lucide-react";

import { spring } from "@/lib/motion";
import {
  connectWallet,
  discoverWallets,
  startWalletDiscovery,
  type ConnectedWallet,
  type DiscoveredWallet,
} from "@/lib/account/wallet";

/**
 * Pick a wallet, when there is more than one.
 *
 * Shown rather than guessed, because guessing is the bug: with several extensions installed they
 * overwrite each other on `window.ethereum`, and the one that wins is whichever loaded last. This
 * lists what actually announced itself and connects the one chosen.
 *
 * With exactly one wallet it connects straight away, because a list of one is not a choice.
 */
export function WalletPicker({
  busy,
  label,
  className,
  onConnected,
  onError,
}: {
  busy: boolean;
  label: string;
  className?: string;
  onConnected: (wallet: ConnectedWallet) => void;
  /** The raw error, so each screen can word the failure in its own voice. */
  onError: (error: unknown) => void;
}) {
  const reduce = useReducedMotion();
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    startWalletDiscovery();
    // Extensions inject at slightly different times, so the list is re-read for a moment rather
    // than captured once on mount.
    const read = () => setWallets(discoverWallets());
    read();
    const timers = [100, 350, 800, 1500].map((ms) => setTimeout(read, ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const connect = async (wallet?: DiscoveredWallet) => {
    setConnecting(wallet?.rdns ?? "only");
    try {
      onConnected(await connectWallet(wallet));
      setChoosing(false);
    } catch (error) {
      onError(error);
    } finally {
      setConnecting(null);
    }
  };

  const none = wallets.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => (wallets.length > 1 ? setChoosing(true) : void connect(wallets[0]))}
        disabled={busy || none}
        aria-disabled={busy || none}
        className={className ?? "btn btn-primary w-full text-[1rem]"}
      >
        <Wallet className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
        {none
          ? "No wallet found in this browser"
          : busy || connecting
            ? "Check your wallet…"
            : wallets.length > 1 && !choosing
              ? `${label} (${wallets.length} found)`
              : label}
      </button>

      <AnimatePresence>
        {choosing ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.settle}
            className="overflow-hidden"
          >
            <ul className="mt-3 grid gap-2">
              {wallets.map((wallet) => (
                <li key={wallet.rdns}>
                  <button
                    type="button"
                    onClick={() => void connect(wallet)}
                    disabled={connecting !== null}
                    className="clay clay-press flex w-full items-center gap-3 p-3.5 text-left"
                  >
                    {wallet.icon ? (
                      // The wallet supplied this. Fixed size, so a large one cannot break the row.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallet.icon} alt="" width={28} height={28} className="size-7 rounded-lg" />
                    ) : (
                      <span className="grid size-7 place-items-center rounded-lg bg-paper">
                        <Wallet className="size-4" strokeWidth={2.2} aria-hidden="true" />
                      </span>
                    )}
                    <span className="font-semibold">{wallet.name}</span>
                    {connecting === wallet.rdns ? (
                      <span className="text-small ml-auto text-ink-muted">Check your wallet…</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setChoosing(false)}
              className="text-small mt-2 text-ink-muted underline underline-offset-4"
            >
              Not now
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {none ? (
        <p className="text-small mt-2 text-ink-muted">
          Install a wallet extension, or set up an account with your passkey instead, which needs no
          wallet at all.
        </p>
      ) : null}
    </>
  );
}
