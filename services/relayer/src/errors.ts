/**
 * Typed errors with the codes `docs/INTERFACES.md` §5 defines.
 *
 * Every failure a caller can see is one of these. Nothing on a request path throws a bare Error,
 * because the bot and the app switch on these codes.
 */

export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "QUOTE_EXPIRED",
  "ACCOUNT_NOT_RESOLVED",
  "COMMITMENT_MISMATCH",
  "INSUFFICIENT_BALANCE",
  "SIMULATION_FAILED",
  "SUBMISSION_FAILED",
  "NOT_WINNER",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  QUOTE_EXPIRED: 410,
  ACCOUNT_NOT_RESOLVED: 422,
  COMMITMENT_MISMATCH: 422,
  INSUFFICIENT_BALANCE: 422,
  SIMULATION_FAILED: 422,
  SUBMISSION_FAILED: 502,
  NOT_WINNER: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * Extra fields on the envelope, for the one error where a message is not enough.
 *
 * Deliberately not a free-for-all: only `INSUFFICIENT_BALANCE` uses it, because "you are short
 * $17.65" needs the number and nothing else here does. Values are strings, since a `bigint` cannot
 * be serialised and a `number` would round somebody's balance.
 */
export type ErrorData = Record<string, string>;

export class RelayerError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly data?: ErrorData | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; data?: ErrorData },
  ) {
    super(message, options);
    this.name = "RelayerError";
    this.code = code;
    this.status = STATUS[code];
    this.data = options?.data;
  }

  /** The wire shape: `{ error: { code, message } }`, plus `data` where §5 defines it. */
  toJSON(): { error: { code: ErrorCode; message: string; data?: ErrorData } } {
    return {
      error: { code: this.code, message: this.message, ...(this.data ? { data: this.data } : {}) },
    };
  }
}

/**
 * Anything unexpected becomes INTERNAL with a generic message.
 *
 * The real cause is logged, never returned: a revert string or a stack trace on a payments API
 * tells an attacker more than it tells the sender.
 */
export function toRelayerError(cause: unknown): RelayerError {
  if (cause instanceof RelayerError) return cause;
  return new RelayerError("INTERNAL", "Something went wrong. Nothing was charged.", { cause });
}
