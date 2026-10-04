"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: these facts do not change while the page is open. */
const never = () => () => {};

/**
 * A fact about this device, read once hydration is done.
 *
 * The server cannot know whether this phone has Face ID, or which key it can sign with, so both are
 * read on the client — and the first client render still has to match the server's HTML or React
 * discards it. Reading them in an effect does that, but it sets state during the first commit, which
 * is a cascading render and is flagged as one.
 *
 * This is the same two renders with the hydration value named out loud instead of smuggled in as a
 * `useState` initialiser.
 *
 * `read` must return something referentially stable — a string, a number, null — or the store will
 * re-render forever looking for a value that settles.
 */
export function useDeviceFact<T>(read: () => T, duringHydration: T): T {
  return useSyncExternalStore(never, read, () => duringHydration);
}
