/**
 * Two rails with a payment travelling along the top one. Shared by the site and the app.
 *
 * One hue: the mark is lit from the top like the primary button, and the payment is lilac — the
 * same colour that marks live chain data everywhere else (docs/DESIGN.md §2).
 */
export function RailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="rail-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b74ff" />
          <stop offset="100%" stopColor="#6e54ff" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="8" fill="url(#rail-mark)" />
      <path d="M6 11.5h11.5M6 17.5h16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="21.5" cy="11.5" r="2.6" fill="#ddd7fe" />
    </svg>
  );
}
