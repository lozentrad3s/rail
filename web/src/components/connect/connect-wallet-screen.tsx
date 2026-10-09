"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, CircleAlert, Coins, Landmark, ShieldCheck, Wallet } from "lucide-react";
import type { Address } from "viem";

import { Assurance, Notice, Screen } from "@/components/sender/screen";
import { WalletPicker } from "@/components/connect/wallet-picker";
import { WalletBalances } from "@/components/connect/wallet-balances";
import { spring } from "@/lib/motion";
import {
  forgetWallet,
  resumeWallet,
  WalletError,
  type WalletFailure,
} from "@/lib/account/wallet";

/**
 * Connecting a wallet the sender already has.
 *
 * This is the one surface where the machinery is named, because someone arriving with MetaMask
 * already has a wallet and pretending otherwise would make the screen unusable — see the connect
 * exemption in CLAUDE.md. The chat never says any of these words.
 */

const FAILURES: Record<WalletFailure, { title: string; detail: string }> = {
  "no-wallet": {
    title: "No wallet in this browser",
    detail:
      "Open Rail in MetaMask, Rabby or another wallet's browser. Or set up a Rail account with Face ID instead, which needs no wallet at all.",
  },
  rejected: {
    title: "You declined the request",
    detail: "Nothing was connected and nothing was moved. Tap again whenever you're ready.",
  },
  "wrong-network": {
    title: "That wallet couldn't switch to Monad",
    detail: "Switch it to Monad Testnet yourself, then try again.",
  },
  "network-add-failed": {
    title: "That wallet couldn't add Monad",
    detail: "Add Monad Testnet to it manually, then try again.",
  },
  unknown: {
    title: "That didn't work",
    detail: "Please try again. Nothing was connected and nothing was moved.",
  },
};

const short = (address: Address): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function ConnectWalletScreen() {
  const router = useRouter();
  const reduce = useReducedMotion();

  const [address, setAddress] = useState<Address | null>(null);
  const [failure, setFailure] = useState<WalletFailure | null>(null);

  // Reconnect without prompting if this browser already granted access.
  useEffect(() => {
    void resumeWallet().then((wallet) => {
      if (wallet) setAddress(wallet.address);
    });
  }, []);

  const disconnect = () => {
    forgetWallet();
    setAddress(null);
  };

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
          {address ? (
            <motion.div
              key="connected"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.settle}
            >
              <span className="flex size-12 items-center justify-center rounded-full bg-accent text-white">
                <Check className="size-6" strokeWidth={2.6} aria-hidden="true" />
              </span>
              <h1 className="text-h2 mt-6">Connected.</h1>

              <p className="text-small mt-2 font-mono text-ink-muted">{short(address)}</p>

              <WalletBalances address={address} needsGas={false} />

              <p className="text-lead mt-6 text-ink-muted">
                Nothing has moved, and nothing will until you approve something. What would you like
                to do?
              </p>

              {/*
               * Two different people arrive here with a wallet, and they want different screens. A
               * provider used to land on the sender dashboard with no way to the provider one.
               */}
              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/account")}
                  className="clay clay-press flex w-full items-center gap-3 p-4 text-left"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white">
                    <ArrowRight className="size-5" strokeWidth={2.4} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-semibold">Send money home</span>
                    <span className="text-small block text-ink-muted">
                      One signature per transfer, for exactly that transfer.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/provider")}
                  className="clay clay-press flex w-full items-center gap-3 p-4 text-left"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-accent shadow-[var(--clay-raise)]">
                    <Landmark className="size-5" strokeWidth={2.2} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-semibold">Become a provider</span>
                    <span className="text-small block text-ink-muted">
                      Stake, bid on transfers, pay out from your bank, earn your bid.
                    </span>
                  </span>
                </button>
              </div>

              <button type="button" onClick={disconnect} className="btn btn-secondary-paper mt-6 w-full">
                Disconnect
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
                <Wallet className="size-6" strokeWidth={2.2} aria-hidden="true" />
              </span>
              <h1 className="text-h2 mt-6">
                Use the wallet you <span className="accent-serif text-accent">already have</span>.
              </h1>
              <p className="text-lead mt-4 text-ink-muted">
                Connect any EVM wallet on Monad. There is nothing to top up and no balance to move:
                your dollars stay where they are until a transfer you approve takes exactly what it
                needs.
              </p>

              <div className="mt-9">
                <WalletPicker
                  busy={false}
                  label="Connect wallet"
                  onConnected={(wallet) => {
                    setFailure(null);
                    setAddress(wallet.address);
                  }}
                  onError={(error) =>
                    setFailure(error instanceof WalletError ? error.reason : "unknown")
                  }
                />
              </div>

              <button
                type="button"
                onClick={() => router.push("/start")}
                className="btn btn-secondary-paper mt-3 w-full"
              >
                I don&apos;t have a wallet, use Face ID
              </button>

              <ul className="text-small mt-11 grid gap-3.5 text-ink-muted">
                <Assurance icon={<ShieldCheck className="size-[18px]" strokeWidth={2} />}>
                  Rail never asks for a seed phrase and never asks to send a transaction. It asks for
                  one signature, for one transfer, at the moment you approve it.
                </Assurance>
                <Assurance icon={<Wallet className="size-[18px]" strokeWidth={2} />}>
                  Your wallet will ask to switch to Monad Testnet, and to add it if it has not seen it
                  before. That is expected during the pilot: Rail runs on the test network with test
                  dollars.
                </Assurance>
                <Assurance icon={<Coins className="size-[18px]" strokeWidth={2} />}>
                  The authorisation covers the most a transfer can cost. Whatever the auction saves
                  comes straight back to you.
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
                title={FAILURES[failure].title}
              >
                {FAILURES[failure].detail}
              </Notice>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Screen>
  );
}
