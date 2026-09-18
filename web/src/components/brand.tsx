/** Two rails with a payment travelling along the top one. Shared by the site and the app. */
export function RailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="8" fill="#6e54ff" />
      <path d="M6 11.5h11.5M6 17.5h16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="21.5" cy="11.5" r="2.6" fill="#85e6ff" />
    </svg>
  );
}
