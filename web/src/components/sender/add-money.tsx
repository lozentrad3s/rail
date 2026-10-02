"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Putting dollars into a Face ID account.
 *
 * A connected account needs none of this: its authorisation pulls exactly what a transfer costs at
 * the moment the transfer happens, so there is nothing to top up. A Face ID account is different,
 * it holds its own balance, and until now there was no way to put anything into it. That was the
 * gap this closes.
 *
 * There is no deposit button, because there is nothing for Rail to do here. Money arrives from
 * wherever the sender already keeps it, into an account only their face can spend from.
 *
 * No QR code. A real encoder is a dependency and a decorative one that cannot be scanned would
 * waste somebody's time at exactly the wrong moment, so the address is text that can be copied.
 */
export function AddMoney({ address }: { address: `0x${string}` }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. The address is on screen and selectable either way.
    }
  };

  return (
    <section className="clay mt-10 p-5" aria-label="Add money">
      <h2 className="text-h3">Add money</h2>
      <p className="text-small mt-2 text-ink-muted">
        Send digital dollars to this account from wherever you keep them. Only your face can spend
        from it.
      </p>

      <div className="clay-press mt-4 rounded-[14px] bg-paper p-3.5">
        <p className="text-label text-ink-muted">Your account</p>
        <p className="mt-1 font-mono text-[0.8125rem] leading-relaxed break-all">{address}</p>
      </div>

      <button
        type="button"
        onClick={() => void copy()}
        className="btn btn-secondary-paper clay-press mt-3"
      >
        {copied ? (
          <Check className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
        ) : (
          <Copy className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy address"}
      </button>

      <p className="text-small mt-4 text-ink-muted">
        Check the first and last four characters match before you send anything. Already keep
        dollars elsewhere? Connecting that account instead means nothing to top up at all.
      </p>
    </section>
  );
}
