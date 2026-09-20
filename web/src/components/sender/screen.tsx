import type { ReactNode } from "react";
import { RailMark } from "@/components/brand";
import { cn } from "@/lib/format";

/**
 * The app's one layout: a narrow column, generous air, nothing competing with the action.
 *
 * Padding respects the notch and the home bar, because this is installed to a home screen and owns
 * the whole display.
 */
export function Screen({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "safe-top safe-bottom gutter mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col",
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <RailMark className="size-7" />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Rail</span>
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

/** A quiet reassurance line with an icon. Colour never carries the meaning on its own. */
export function Assurance({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-px shrink-0 text-accent" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * A problem the person can act on.
 *
 * Errors are red text with an icon, never colour alone, and they say what happened to their money —
 * which is usually "nothing".
 */
export function Notice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="mt-5 rounded-[18px] bg-surface p-4 shadow-card">
      <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-slash-text">
        <span aria-hidden="true">{icon}</span>
        {title}
      </p>
      {children ? <p className="text-small mt-1.5 text-ink-muted">{children}</p> : null}
    </div>
  );
}
