"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Rises 12px and fades in once, when scrolled into view.
 *
 * Progressive enhancement: the server renders content fully visible. Only elements that start below
 * the fold are hidden after hydration, so a slow or failed script never leaves a blank page. The
 * transition is CSS (see `[data-reveal]` in globals.css), which stays smooth while the main thread is
 * busy. Reduced motion: fade only.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    // The observer's first callback says where the element starts, using geometry the browser has
    // already computed. Reading layout here instead would force a synchronous layout per instance.
    let first = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (first) {
          first = false;
          if (entry.boundingClientRect.top < window.innerHeight) {
            observer.disconnect();
            return;
          }
          el.dataset.reveal = "hidden";
          return;
        }
        if (!entry.isIntersecting) return;
        el.dataset.reveal = "shown";
        observer.disconnect();
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ "--reveal-delay": `${delay}s` } as CSSProperties}>
      {children}
    </div>
  );
}
