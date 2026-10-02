import { EyeOff, KeyRound, MessageSquareOff, Scale, Unplug } from "lucide-react";
import { Chapter, Container, Eyebrow } from "./primitives";
import { PayOrSlash } from "./pay-or-slash";
import { Reveal } from "./reveal";

const GUARANTEES = [
  {
    icon: Unplug,
    title: "Works even if we disappear",
    body: "Settling and refunding are open to anyone. No server of ours has to be running for you to get paid or refunded.",
  },
  {
    icon: EyeOff,
    title: "Bank details stay private",
    body: "Your family’s account number never goes on the public ledger — only a sealed fingerprint of it.",
  },
  {
    icon: Scale,
    title: "A record nobody can edit",
    body: "Provider reputation is counted from what they actually delivered. There is no setting to change it — not even for us.",
  },
];

export function Safety() {
  return (
    <Chapter id="safety" tone="paper" labelledBy="safety-title" className="chapter-pad">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-20">
          <Reveal>
            <Eyebrow tone="paper">Safety</Eyebrow>
            <h2 id="safety-title" className="mt-5 text-h2">
              We never hold your money. <span className="accent-serif">Providers stake theirs.</span>
            </h2>
            <p className="mt-6 max-w-[34rem] text-lead text-ink-muted">
              Rail doesn’t touch naira — it can’t. The winning provider pays from their own bank. Until the payment
              is proven, your dollars stay locked in an open contract, with the provider’s stake locked beside them.
            </p>
            <p className="mt-4 max-w-[34rem] text-body text-ink-muted">
              Flip the switch to see both endings.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <PayOrSlash />
          </Reveal>
        </div>

        <Reveal className="mt-20">
          <div className="grid gap-4 rounded-card bg-night p-6 text-night-text sm:p-8 lg:grid-cols-[1fr_1fr_1fr] lg:gap-8">
            <div className="lg:col-span-1">
              <p className="text-label text-night-muted">The stolen-phone test</p>
              <h3 className="mt-3 text-h3">Someone takes over your chat. What can they do?</h3>
            </div>
            <div className="rounded-[18px] bg-night-raised p-5">
              <p className="flex items-center gap-2 font-semibold">
                <MessageSquareOff className="size-5 text-slash" strokeWidth={2} aria-hidden="true" />
                Apps that approve in the chat
              </p>
              <p className="mt-2 text-small text-night-muted">
                If a PIN typed into the chat approves payments, whoever controls the chat can find or guess it — and
                send your money.
              </p>
            </div>
            <div className="rounded-[18px] bg-night-raised p-5 shadow-[inset_0_0_0_1.5px_rgb(110_84_255/0.6)]">
              <p className="flex items-center gap-2 font-semibold">
                <KeyRound className="size-5 text-accent-soft" strokeWidth={2} aria-hidden="true" />
                Rail
              </p>
              <p className="mt-2 text-small text-night-muted">
                They can draft a payment. Only your Face ID can approve one, and your face isn’t in the chat. The chat
                proposes; your phone decides.
              </p>
            </div>
          </div>
        </Reveal>

        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {GUARANTEES.map((item, i) => (
            <li key={item.title}>
              <Reveal delay={0.05 * i} className="h-full rounded-card bg-surface p-6 shadow-card">
                <item.icon className="size-5 text-accent" strokeWidth={2} aria-hidden="true" />
                <h3 className="mt-4 text-[1.0625rem] font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="mt-2 text-small text-ink-muted">{item.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </Chapter>
  );
}
