/**
 * A simulated bank, for the testnet pilot only.
 *
 * A real provider wins, pays the recipient from its own bank, then marks the order paid. This bot
 * has no bank account and must not pretend otherwise, so on a win it writes down the payout it
 * *would* have made, labelled as simulated, and serves it in the same shape a bank feed would.
 *
 * That lets the rest of the system run for real: the CRE payout-attestor queries this exactly as it
 * would query Mono or Paystack, the DON reaches consensus on what it says, and the escrow settles.
 * The only fiction is the naira, and every surface says so.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";

export type SimulatedCredit = {
  reference: string;
  narration: string;
  amountMinor: string;
  currency: string;
  status: "successful";
  simulated: true;
  orderId: Hex;
  at: string;
};

/** The reference a provider puts on the bank transfer — docs/INTERFACES.md §3.7. */
export function narrationFor(orderId: Hex): string {
  return `RAIL${orderId.slice(2, 10).toUpperCase()}`;
}

export class SimulatedBank {
  readonly #file: string;
  #credits: SimulatedCredit[];

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.#file = join(dir, "simulated-credits.json");
    try {
      this.#credits = JSON.parse(readFileSync(this.#file, "utf8")) as SimulatedCredit[];
    } catch {
      this.#credits = [];
    }
  }

  /** Records the payout this bot would have sent. Idempotent per order. */
  pay(orderId: Hex, currency: string, amountMinor: bigint): SimulatedCredit {
    const existing = this.#credits.find((c) => c.orderId === orderId);
    if (existing) return existing;

    const credit: SimulatedCredit = {
      reference: `SIM-${orderId.slice(2, 12).toUpperCase()}`,
      narration: narrationFor(orderId),
      amountMinor: amountMinor.toString(),
      currency,
      status: "successful",
      simulated: true,
      orderId,
      at: new Date().toISOString(),
    };
    this.#credits = [...this.#credits.slice(-499), credit];
    writeFileSync(this.#file, JSON.stringify(this.#credits), { flush: true });
    return credit;
  }

  /** What a bank feed returns for one reference: matching credits only, as a real query would. */
  query(narration: string, currency?: string): SimulatedCredit[] {
    const wanted = narration.trim().toUpperCase();
    return this.#credits.filter(
      (c) =>
        c.narration === wanted && (currency === undefined || c.currency === currency.toUpperCase()),
    );
  }
}
