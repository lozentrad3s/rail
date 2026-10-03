"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { site } from "@/lib/site";
import { RailMark, type Tone } from "./primitives";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#auction", label: "The auction" },
  { href: "#safety", label: "Safety" },
  { href: "#why-monad", label: "Why Monad" },
  // A real page, not an anchor: somebody who wants to supply naira should not have to read a
  // chapter about it first.
  { href: "/provider", label: "For providers" },
];

/** Floating glass bar. Its material follows whichever chapter is passing underneath it. */
export function Nav() {
  const [tone, setTone] = useState<Tone>("night");

  useEffect(() => {
    const chapters = document.querySelectorAll<HTMLElement>("[data-chapter]");
    // A thin band where the bar sits: from 32px below the top edge to 10% of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setTone(entry.target.getAttribute("data-chapter") === "paper" ? "paper" : "night");
          }
        }
      },
      { rootMargin: "-32px 0px -90% 0px" },
    );
    chapters.forEach((chapter) => observer.observe(chapter));
    return () => observer.disconnect();
  }, []);

  const night = tone === "night";

  return (
    <header className="gutter fixed inset-x-0 top-0 z-50 pt-3">
      <nav
        aria-label="Primary"
        className={cn(
          "mx-auto flex h-14 max-w-[72rem] items-center justify-between rounded-2xl pr-2 pl-3 transition-[background-color,color,box-shadow] duration-300",
          night ? "glass-night text-night-text" : "glass-paper text-ink",
        )}
      >
        <a href="#top" className="press flex items-center gap-2.5 rounded-lg pr-2" aria-label="Rail, back to top">
          <RailMark className="size-7" />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Rail</span>
        </a>

        <ul className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className={cn(
                  "text-small rounded-lg px-3 py-2 transition-colors duration-150",
                  night ? "text-night-muted hover:text-night-text" : "text-ink-muted hover:text-ink",
                )}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5">
          {/*
           * The way into the app itself. /account sends anyone without an account to /start, so one
           * link serves both the returning sender and the first-time one.
           */}
          <a
            href="/account"
            className={cn(
              "text-small rounded-lg px-3 py-2 transition-colors duration-150",
              night ? "text-night-muted hover:text-night-text" : "text-ink-muted hover:text-ink",
            )}
          >
            Open app
          </a>
          <a
            href={site.primaryCta.href}
            className="btn btn-sm btn-primary"
            {...(site.primaryCta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {site.primaryCta.short}
          </a>
        </div>
      </nav>
    </header>
  );
}
