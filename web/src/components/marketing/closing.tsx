import { site } from "@/lib/site";
import { ButtonLink, Chapter, Container, Eyebrow, RailMark } from "./primitives";
import { Reveal } from "./reveal";

// Sender register for the call to action; the footer credits the stack plainly.
export function Closing() {
  return (
    <Chapter id="pilot" tone="night" labelledBy="closing-title" className="overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_50%_100%,rgb(110_84_255/0.32),transparent_70%)]"
      />
      <Container className="chapter-pad text-center">
        <Reveal className="mx-auto max-w-[44rem]">
          <Eyebrow tone="night">
            <span className="size-1.5 rounded-full bg-signal" />
            {site.pilotLabel}
          </Eyebrow>
          <h2 id="closing-title" className="mt-6 text-display">
            Money that gets <span className="accent-serif text-accent-soft">home</span>.
          </h2>
          <p className="mx-auto mt-6 max-w-[34rem] text-lead text-night-muted">
            The pilot runs from the UK and US to Nigeria, with real families and real providers. The auction
            does not care where the money lands, so Ghana, Kenya, India and the Philippines come next, and a
            business paying a supplier in Europe or Asia uses the same rails.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href={site.primaryCta.href} tone="night" external={site.primaryCta.external}>
              {site.primaryCta.external ? site.primaryCta.label : "Run the auction again"}
            </ButtonLink>
            {site.repoUrl && (
              <ButtonLink href={site.repoUrl} tone="night" variant="secondary" external>
                Read the protocol
              </ButtonLink>
            )}
          </div>
        </Reveal>
      </Container>

      <footer className="border-t border-night-line">
        <Container className="flex flex-col gap-6 py-10 text-small text-night-muted md:flex-row md:items-start md:justify-between">
          <div className="max-w-[28rem]">
            <p className="flex items-center gap-2.5 text-night-text">
              <RailMark className="size-6" />
              <span className="font-semibold tracking-[-0.02em]">Rail</span>
            </p>
            <p className="mt-3">
              Rail never holds or moves fiat currency. Payouts are made by independent providers from their own
              accounts. Figures marked illustrative, simulation or target are not live results.
            </p>
          </div>
          <div className="md:text-right">
            <p>Built on Monad · Settles in AUSD by Agora · Passkeys by Mera</p>
            <p className="mt-1.5">Monad Metropolis 2026 · Consumer Products &amp; Payments</p>
          </div>
        </Container>
      </footer>
    </Chapter>
  );
}
