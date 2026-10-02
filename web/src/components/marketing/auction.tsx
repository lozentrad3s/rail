import { AuctionSim } from "./auction-sim";
import { Chapter, Container, Eyebrow } from "./primitives";
import { Reveal } from "./reveal";

export function Auction() {
  return (
    <Chapter id="auction" tone="night" labelledBy="auction-title" className="chapter-pad overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_40%_at_50%_0%,rgb(110_84_255/0.22),transparent_70%)]"
      />
      <Container>
        <Reveal className="mx-auto max-w-[52rem] text-center">
          <Eyebrow tone="night">The auction</Eyebrow>
          <h2 id="auction-title" className="mt-5 text-h2">
            <span className="sm:whitespace-nowrap">Half a minute. Sealed bids.</span>{" "}
            <span className="accent-serif text-accent-soft sm:block">Lowest wins.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[38rem] text-lead text-night-muted">
            Every transfer is auctioned. Providers commit to a price nobody else can see, then reveal it. The
            cheapest provider who has staked enough to cover their bid wins, and the difference goes back to
            the sender.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mx-auto mt-14 max-w-[64rem]">
          <AuctionSim />
        </Reveal>

        <Reveal delay={0.15}>
          <dl className="mx-auto mt-12 grid max-w-[64rem] gap-6 text-small sm:grid-cols-3">
            <div>
              <dt className="font-semibold text-night-text">Why seal the bids?</dt>
              <dd className="mt-1.5 text-night-muted">
                On an open ledger a bid is public the moment it lands in a block. Unsealed, everyone would just
                undercut the last price by a cent.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-night-text">Why 110% collateral?</dt>
              <dd className="mt-1.5 text-night-muted">
                A provider always has more locked than they could take. Walking away costs more than delivering.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-night-text">Who keeps the saving?</dt>
              <dd className="mt-1.5 text-night-muted">
                The sender. The winner receives exactly their bid. The contract returns the rest. Rail takes no
                cut of the spread.
              </dd>
            </div>
          </dl>
        </Reveal>
      </Container>
    </Chapter>
  );
}
