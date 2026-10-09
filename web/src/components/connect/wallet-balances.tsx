"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { Droplets, ExternalLink, RefreshCw } from "lucide-react";

import { cn } from "@/lib/format";
import { addPracticeMoney, ApiError } from "@/lib/rail-api";
import { AUSD_DECIMALS, client, SETTLEMENT_ASSET } from "@/lib/provider/chain";

/**
 * What this wallet actually holds, by asset.
 *
 * Somebody arriving with Zerion or MetaMask holds MON, maybe AUSD, maybe both, and could not tell
 * from the old screen which of the two Rail would use. Rail settles in AUSD only: MON pays for gas
 * and cannot fund a transfer. Saying that plainly, beside both numbers, is the difference between
 * "why does it say I have nothing" and knowing what to do next.
 *
 * Lives on the wallet surfaces only — `/connect` and `/provider` — which name the machinery by
 * design (CLAUDE.md). Never imported from a sender path.
 */

const MON_FAUCET = "https://faucet.monad.xyz";

export type Holdings = { ausdUnits: bigint; monWei: bigint };

export async function readHoldings(address: Address): Promise<Holdings> {
  const [ausdUnits, monWei] = await Promise.all([
    client.readContract({ address: SETTLEMENT_ASSET, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address }),
  ]);
  return { ausdUnits, monWei };
}

const dollars = (units: bigint) =>
  `$${Number(formatUnits(units, AUSD_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mon = (wei: bigint) =>
  Number(formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });

export function WalletBalances({
  address,
  needsGas,
  onChange,
}: {
  address: Address;
  /** A provider signs its own transactions and needs MON; a sender does not, the relayer pays. */
  needsGas: boolean;
  onChange?: (holdings: Holdings) => void;
}) {
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [reading, setReading] = useState(false);
  const [topping, setTopping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const read = useCallback(async () => {
    setReading(true);
    try {
      const next = await readHoldings(address);
      setHoldings(next);
      onChange?.(next);
      return next;
    } catch {
      setMessage("Could not read this wallet's balances. Tap refresh in a moment.");
      return null;
    } finally {
      setReading(false);
    }
  }, [address, onChange]);

  // First read on arrival. State is only set once the chain answers, never synchronously here.
  useEffect(() => {
    let cancelled = false;
    readHoldings(address)
      .then((next) => {
        if (cancelled) return;
        setHoldings(next);
        onChange?.(next);
      })
      .catch(() => {
        if (!cancelled) setMessage("Could not read this wallet's balances. Tap refresh in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, [address, onChange]);

  const topUp = async () => {
    setTopping(true);
    setMessage(null);
    const before = holdings?.ausdUnits ?? 0n;
    try {
      await addPracticeMoney(address);
      // The faucet's transfer lands in a block or two; poll briefly rather than claim it arrived.
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const next = await read();
        if (next && next.ausdUnits > before) {
          setMessage(`Added ${dollars(next.ausdUnits - before)} in test AUSD.`);
          return;
        }
      }
      setMessage("Requested. It can take a few seconds to show — tap refresh.");
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.reason === "too-soon"
          ? error.message
          : "The test faucet could not be reached. Try again in a moment.",
      );
    } finally {
      setTopping(false);
    }
  };

  const noDollars = holdings !== null && holdings.ausdUnits === 0n;
  const noGas = holdings !== null && holdings.monWei === 0n;

  return (
    <section className="clay mt-6 p-5" aria-label="Wallet balances">
      <div className="flex items-center justify-between gap-3">
        <p className="text-label text-ink-muted">In this wallet</p>
        <button
          type="button"
          onClick={() => void read()}
          className="press -m-2 grid size-10 place-items-center rounded-full text-ink-muted"
          aria-label="Refresh balances"
        >
          <RefreshCw className={cn("size-[17px]", reading && "animate-spin")} strokeWidth={2.2} />
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className={cn("rounded-[14px] bg-paper p-3.5", noDollars && "ring-1 ring-slash-text/40")}>
          <dt className="text-small text-ink-muted">AUSD · dollars</dt>
          <dd className="figure mt-1 text-[1.375rem] leading-none tabular-nums">
            {holdings ? dollars(holdings.ausdUnits) : <span className="skeleton">$0.00</span>}
          </dd>
          <dd className="text-small mt-1.5 text-ink-muted">What Rail sends and stakes</dd>
        </div>
        <div className={cn("rounded-[14px] bg-paper p-3.5", needsGas && noGas && "ring-1 ring-slash-text/40")}>
          <dt className="text-small text-ink-muted">MON</dt>
          <dd className="figure mt-1 text-[1.375rem] leading-none tabular-nums">
            {holdings ? mon(holdings.monWei) : <span className="skeleton">0</span>}
          </dd>
          <dd className="text-small mt-1.5 text-ink-muted">
            {needsGas ? "Pays network fees" : "Not needed: Rail pays fees"}
          </dd>
        </div>
      </dl>

      {noDollars ? (
        <p className="text-small mt-4 text-ink-muted">
          Rail moves AUSD, a dollar stablecoin, and cannot spend MON on a transfer.
          {holdings && holdings.monWei > 0n ? " Your MON stays where it is." : ""} During the pilot you
          can get test AUSD free:
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void topUp()}
          disabled={topping}
          className={cn("btn clay-press", noDollars ? "btn-primary" : "btn-secondary-paper")}
        >
          <Droplets className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
          {topping ? "Adding…" : "Get $10,000 test AUSD"}
        </button>
        {needsGas && noGas ? (
          <a href={MON_FAUCET} target="_blank" rel="noopener noreferrer" className="btn btn-secondary-paper clay-press">
            <ExternalLink className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
            Get test MON
          </a>
        ) : null}
      </div>

      {message ? (
        <p className="text-small mt-3 text-accent" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
