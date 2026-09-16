// Motion presets — docs/DESIGN.md §6. Import these; never inline springs or curves in components.

export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

export const spring = {
  /** Default for everything: critically damped, no overshoot. */
  settle: { type: "spring", bounce: 0, duration: 0.4 },
  /** The Face ID sheet. */
  sheet: { type: "spring", bounce: 0.15, duration: 0.45 },
  /** Only after a user flick or drag. */
  flick: { type: "spring", bounce: 0.2, duration: 0.4 },
} as const;

/** Monad's block time. The auction simulation ticks at this rate — it's a fact, not a style. */
export const BLOCK_MS = 300;
