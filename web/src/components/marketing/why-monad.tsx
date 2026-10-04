import { Chapter, Container, Eyebrow, SourceLink } from "./primitives";
import { Reveal } from "./reveal";
import { auction } from "@/lib/site";

// Builder register: precise terms are welcome here (docs/DESIGN.md §8).
const STATS = [
  { value: "300ms", label: "Block time", note: "One tick of the auction" },
  { value: "600ms", label: "Finality", note: "A won bid is settled, not provisional" },
  {
    value: `~${auction.totalSeconds}s`,
    label: "A full sealed auction",
    note: `${auction.commitBlocks} commit blocks + ${auction.revealBlocks} reveal blocks`,
  },
  { value: "≈0", label: "Fees", note: "Near-zero, so a $50 transfer is worth auctioning" },
];

const STACK = [
  "AUSD by Agora, native EIP-3009",
  "Passkey accounts by Mera",
  "Gas paid by a relayer, never the sender",
  "Permissionless finalize & refund",
  "Commit–reveal auction · 110% collateral",
  "Salted commitments, no PII on-chain",
];

export function WhyMonad() {
  return (
    <Chapter id="why-monad" tone="night" labelledBy="monad-title" className="chapter-pad overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_50%_at_85%_20%,rgb(133_230_255/0.10),transparent_70%),radial-gradient(50%_50%_at_10%_90%,rgb(110_84_255/0.18),transparent_70%)]"
      />
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <Reveal>
            <Eyebrow tone="night">Why Monad</Eyebrow>
            <h2 id="monad-title" className="mt-5 text-h2">
              The auction only works because the chain is <span className="accent-serif text-accent-soft">this fast</span>.
            </h2>
            <p className="mt-6 max-w-[36rem] text-lead text-night-muted">
              Sealed-bid auctions are decades old. On a transparent ledger a bid is public the moment it lands in a
              block, so it has to be committed first and revealed later, which makes two rounds. On most chains that takes too
              long, or costs too much, to sit inside a payment.
            </p>
            <p className="mt-4 max-w-[36rem] text-body text-night-muted">
              On Monad a round is measured in blocks, not minutes. Our pilot runs {auction.commitBlocks} blocks
              each way, about {auction.totalSeconds} seconds for both rounds and final settlement, at near-zero
              fees. The windows are that wide so a person can bid by hand and not only a bot, which is what makes
              this a market anyone can join. And every sender is a new Monad account, created with a passkey by
              someone who has never used crypto.
            </p>
            <blockquote className="mt-10 border-l-2 border-accent pl-5">
              <p className="text-[clamp(1.375rem,1.1rem+1vw,1.75rem)] leading-[1.3] tracking-[-0.015em]">
                “We didn’t invent the auction. We’re the first people who could{" "}
                <span className="accent-serif text-accent-soft">afford to run it</span>.”
              </p>
            </blockquote>
          </Reveal>

          <div>
            <dl className="grid grid-cols-2 gap-3">
              {STATS.map((stat, i) => (
                <Reveal
                  key={stat.label}
                  delay={0.05 * i}
                  className="rounded-[20px] bg-night-raised p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
                >
                  <dt className="text-label text-night-muted">{stat.label}</dt>
                  <dd>
                    <span className="figure mt-3 block text-[clamp(1.875rem,1.4rem+1.6vw,2.625rem)] leading-none tracking-[-0.03em] text-signal">
                      {stat.value}
                    </span>
                    <span className="mt-2 block text-small text-night-muted">{stat.note}</span>
                  </dd>
                </Reveal>
              ))}
            </dl>
            <p className="mt-4">
              <SourceLink href="https://www.monad.xyz/" tone="night">
                Block time and finality: monad.xyz
              </SourceLink>
            </p>

            <Reveal delay={0.2} className="mt-10">
              <p className="text-label text-night-muted">Under the hood</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {STACK.map((item) => (
                  <li
                    key={item}
                    className="rounded-chip bg-night-line px-3 py-1.5 text-small text-night-text shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </Container>
    </Chapter>
  );
}
