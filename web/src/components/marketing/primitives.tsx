import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export type Tone = "night" | "paper";

/** A chapter of the story. `data-chapter` lets the nav swap its material as chapters pass under it. */
export function Chapter({
  id,
  tone,
  labelledBy,
  className,
  children,
}: {
  id: string;
  tone: Tone;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-chapter={tone}
      aria-labelledby={labelledBy}
      className={cn(
        "relative isolate scroll-mt-4",
        tone === "night" ? "bg-night text-night-text" : "bg-paper text-ink",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("gutter mx-auto w-full max-w-[72rem]", className)}>{children}</div>;
}

export function Eyebrow({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <p
      className={cn(
        "text-label inline-flex items-center gap-2",
        tone === "night" ? "text-night-muted" : "text-ink-muted",
      )}
    >
      {children}
    </p>
  );
}

type ButtonProps = {
  href: string | null;
  variant?: "primary" | "secondary";
  tone: Tone;
  size?: "md" | "sm";
  disabledLabel?: string;
  external?: boolean;
  className?: string;
  children: ReactNode;
};

/** Link styled as a button. A null href renders an honest disabled state instead of a dead link. */
export function ButtonLink({
  href,
  variant = "primary",
  tone,
  size = "md",
  disabledLabel,
  external,
  className,
  children,
}: ButtonProps) {
  const classes = cn(
    "btn",
    size === "sm" && "btn-sm",
    variant === "primary" ? "btn-primary" : tone === "night" ? "btn-secondary-night" : "btn-secondary-paper",
    className,
  );

  if (!href) {
    return (
      <span role="link" aria-disabled="true" className={classes} title={disabledLabel}>
        {disabledLabel ?? children}
      </span>
    );
  }

  return (
    <a
      href={href}
      className={classes}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Two rails with a payment travelling along the top one. */
export function RailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={className}>
      <rect width="28" height="28" rx="8" fill="#6e54ff" />
      <path d="M6 11.5h11.5M6 17.5h16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="21.5" cy="11.5" r="2.6" fill="#85e6ff" />
    </svg>
  );
}

export function SourceLink({ href, tone, children }: { href: string; tone: Tone; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-small underline decoration-1 underline-offset-4 transition-colors",
        tone === "night"
          ? "text-night-muted decoration-night-line hover:text-night-text"
          : "text-ink-muted decoration-line hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}
