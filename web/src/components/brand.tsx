/**
 * The Rail-Pay mark: an R leaning forward, with the rails it travels on running out behind it.
 *
 * Drawn rather than placed as an image, for two reasons. It has to sit on both the paper and night
 * chapters, and the brand navy vanishes against the night background, so the body colour follows
 * the surface it is on. And a mark in the nav is rendered at 28px and in a share card at 1250px:
 * one path does both, where a PNG does one of them badly.
 *
 * The lilac rail is the same colour that marks live chain data everywhere else (docs/DESIGN.md §2).
 */
export function RailMark({ className, tone = "auto" }: { className?: string; tone?: "auto" | "night" | "paper" }) {
  // On night the body goes white, because #1b2559 on #0e091c is unreadable.
  const body = tone === "night" ? "#ffffff" : tone === "paper" ? "#1b2559" : "currentColor";

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="rail-speed" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      {/* The rails: three, the lowest one carrying the payment. */}
      <path d="M2.5 11h10" stroke={body} strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
      <path d="M5 16h8" stroke={body} strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
      <path d="M1 21h11" stroke="url(#rail-speed)" strokeWidth="2.6" strokeLinecap="round" />

      {/*
       * The R, built from straight edges so it holds its shape at 28px. The bowl is squared off
       * rather than round: a circular counter closes up and turns to mud at nav size.
       */}
      <path
        d="M15 5h8.2a5.4 5.4 0 0 1 0 10.8h-2.1L30 27h-5.6l-7.6-10.4V27H15V5Zm2.8 3.3v4.6h5a2.3 2.3 0 0 0 0-4.6h-5Z"
        fill={body}
      />
    </svg>
  );
}

/** The full lockup, for places with room for the name. */
export function RailLockup({ className, tone = "auto" }: { className?: string; tone?: "auto" | "night" | "paper" }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <RailMark className="size-7" tone={tone} />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">
        Rail<span className="text-accent">-Pay</span>
      </span>
    </span>
  );
}
