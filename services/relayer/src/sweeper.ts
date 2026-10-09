/**
 * Closes orders that nobody else will.
 *
 * `refund` and `finalize` are permissionless (invariant 4), which means anybody *can* call them and,
 * in practice, nobody does. An auction that closes with no bids leaves the sender's dollars in
 * escrow, status `Open`, until a stranger pays gas to send them back — and a sender with no MON
 * cannot be that stranger. On 8 Oct 2026 that stranded $76.63 for a day.
 *
 * So the relayer does it. This is a convenience, never a dependency: if it is down, anyone can still
 * make exactly the same calls and get exactly the same result. It moves no money of its own and
 * cannot choose where money goes; the contract decides that, and only to the sender or the winner.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";

import type { SubmissionQueue } from "./nonce.ts";
import { railCoreAbi } from "./rail.ts";

/** What the sweeper should do with one order, decided from what the contract reports. */
export type SweepAction = "refund" | "finalize" | "wait" | "forget";

/** `None`, `Settled`, `Refunded`, `Cancelled`: nothing left that anyone can call. */
const TERMINAL = new Set([0, 5, 6, 7]);

/**
 * The decision, separated from the chain so it can be tested without one.
 *
 * Refund is checked before finalize because the contract never allows both: an attested order
 * reverts `refund` with `Attested`, and an unattested one past its window cannot `finalize`.
 */
export function decide(status: number, canRefund: boolean, canFinalize: boolean): SweepAction {
  if (TERMINAL.has(status)) return "forget";
  if (canRefund) return "refund";
  if (canFinalize) return "finalize";
  return "wait";
}

/**
 * Margin over the estimate. Monad charges the declared limit, so this is a fixed allowance rather
 * than a multiplier: `refund` measures ~94k and `finalize` a little more, and 40k covers a cold
 * storage slot either way without paying for twice the work.
 */
const GAS_MARGIN = 40_000n;

export type SweeperDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  railCore: Address;
  queue: SubmissionQueue;
  /** Where tracked order ids survive a restart. On the volume, or they are lost on redeploy. */
  file: string;
  /** Optional Envio GraphQL endpoint, to pick up orders this relayer did not submit. */
  indexerUrl?: string | undefined;
  log?: (line: string) => void;
};

export class Sweeper {
  readonly #deps: SweeperDeps;
  readonly #tracked = new Set<Hex>();
  /** Orders with a call already in flight, so one slow block does not produce two transactions. */
  readonly #busy = new Set<Hex>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: SweeperDeps) {
    this.#deps = deps;
    try {
      const saved = JSON.parse(readFileSync(deps.file, "utf8")) as unknown;
      if (Array.isArray(saved)) {
        for (const id of saved) if (typeof id === "string" && /^0x[0-9a-fA-F]{64}$/.test(id)) this.#tracked.add(id as Hex);
      }
    } catch {
      // First run, or an unreadable file: start empty. The indexer seed refills it.
    }
  }

  get size(): number {
    return this.#tracked.size;
  }

  /** Called right after the relayer submits an order, so it is watched from its first block. */
  track(orderId: Hex): void {
    if (this.#tracked.has(orderId)) return;
    this.#tracked.add(orderId);
    this.#save();
  }

  start(intervalMs: number): void {
    if (this.#timer) return;
    void this.#seedFromIndexer().finally(() => void this.tick());
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    // A sweep in progress must never hold the process open past a SIGTERM.
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One pass over every tracked order. Public so a test, or an operator, can force one. */
  async tick(): Promise<void> {
    for (const orderId of [...this.#tracked]) {
      if (this.#busy.has(orderId)) continue;
      try {
        await this.#sweepOne(orderId);
      } catch (cause) {
        // One order failing to read must not stop the rest being swept.
        this.#log(`sweep-error order=${orderId} ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
      }
    }
  }

  async #sweepOne(orderId: Hex): Promise<void> {
    const { publicClient, railCore } = this.#deps;
    const [order, canRefund, canFinalize] = await Promise.all([
      publicClient.readContract({ address: railCore, abi: railCoreAbi, functionName: "getOrder", args: [orderId] }),
      publicClient.readContract({ address: railCore, abi: railCoreAbi, functionName: "canRefund", args: [orderId] }),
      publicClient.readContract({ address: railCore, abi: railCoreAbi, functionName: "canFinalize", args: [orderId] }),
    ]);

    const action = decide(order.status, canRefund, canFinalize);
    if (action === "forget") {
      this.#tracked.delete(orderId);
      this.#save();
      return;
    }
    if (action === "wait") return;

    this.#busy.add(orderId);
    try {
      const hash = await this.#send(action, orderId);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      this.#log(`swept order=${orderId} action=${action} tx=${hash} status=${receipt.status}`);
    } finally {
      this.#busy.delete(orderId);
    }
  }

  async #send(action: "refund" | "finalize", orderId: Hex): Promise<Hex> {
    const { publicClient, walletClient, account, railCore, queue } = this.#deps;
    const estimate = await publicClient.estimateContractGas({
      address: railCore,
      abi: railCoreAbi,
      functionName: action,
      args: [orderId],
      account,
    });
    return queue.submit((nonce) =>
      walletClient.writeContract({
        address: railCore,
        abi: railCoreAbi,
        functionName: action,
        args: [orderId],
        account,
        chain: null,
        gas: estimate + GAS_MARGIN,
        nonce,
      }),
    );
  }

  /**
   * Picks up every live order the indexer knows, not only the ones this process submitted.
   *
   * Ids from other deployments read back as status `None` from this core and are forgotten on the
   * first pass, so the query does not need to know which core an order belongs to.
   */
  async #seedFromIndexer(): Promise<void> {
    const url = this.#deps.indexerUrl;
    if (!url) return;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `{ Order(where: { status: { _in: ["Open", "Awarded", "Paid", "Disputed"] } }, limit: 500) { id } }`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as { data?: { Order?: { id: string }[] } };
      let added = 0;
      for (const { id } of body.data?.Order ?? []) {
        if (/^0x[0-9a-fA-F]{64}$/.test(id) && !this.#tracked.has(id as Hex)) {
          this.#tracked.add(id as Hex);
          added += 1;
        }
      }
      if (added > 0) this.#save();
      this.#log(`sweep-seed added=${added} tracked=${this.#tracked.size}`);
    } catch (cause) {
      // The indexer is a convenience to the convenience. Tracking what we submit still works.
      this.#log(`sweep-seed-failed ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.#deps.file), { recursive: true });
      writeFileSync(this.#deps.file, JSON.stringify([...this.#tracked]), { flush: true });
    } catch (cause) {
      this.#log(`sweep-save-failed ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  #log(line: string): void {
    (this.#deps.log ?? ((text: string) => console.log(`${new Date().toISOString()} ${text}`)))(line);
  }
}
