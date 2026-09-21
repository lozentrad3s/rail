/**
 * Bank lookups through Paystack.
 *
 * Resolving the account name is the single most valuable check in the whole flow. It is what lets
 * the app show "ADAEZE O. OKONKWO" before Face ID, so a sender can see they are about to pay the
 * right person — and it is the reason a compromised bot cannot quietly redirect money: the name
 * would change, and the sender would see it.
 */
import { RelayerError } from "./errors.ts";

const PAYSTACK = "https://api.paystack.co";
/** A bank list changes rarely; asking on every request would be rude and slow. */
const BANKS_TTL_MS = 6 * 60 * 60 * 1000;

export type Bank = { code: string; name: string };

type Cached = { at: number; banks: Bank[] };
const cache = new Map<string, Cached>();

export type PaystackDeps = {
  secretKey: string | undefined;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

async function call(deps: PaystackDeps, path: string): Promise<unknown> {
  if (!deps.secretKey) {
    throw new RelayerError(
      "ACCOUNT_NOT_RESOLVED",
      "Bank name checking is not configured yet.",
    );
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${PAYSTACK}${path}`, {
      headers: { Authorization: `Bearer ${deps.secretKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new RelayerError("ACCOUNT_NOT_RESOLVED", "Could not reach the bank directory.", { cause });
  }

  const body = (await response.json().catch(() => ({}))) as { status?: boolean; data?: unknown; message?: string };
  if (!response.ok || body.status !== true) {
    // Paystack says "Could not resolve account name. Check parameters or try again."
    throw new RelayerError(
      "ACCOUNT_NOT_RESOLVED",
      body.message ?? "That account could not be found. Check the number and the bank.",
    );
  }
  return body.data;
}

/** The banks a sender can choose from, for one currency. */
export async function listBanks(deps: PaystackDeps, currency: string): Promise<Bank[]> {
  const country = COUNTRY_FOR_CURRENCY[currency];
  if (!country) throw new RelayerError("BAD_REQUEST", `No bank list for ${currency}.`);

  const cached = cache.get(currency);
  if (cached && Date.now() - cached.at < BANKS_TTL_MS) return cached.banks;

  const data = (await call(deps, `/bank?country=${country}&currency=${currency}`)) as Array<{
    code: string;
    name: string;
  }>;
  const banks = data
    .map((bank) => ({ code: bank.code, name: bank.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cache.set(currency, { at: Date.now(), banks });
  return banks;
}

/** The name on the account, so the sender can see who they are about to pay. */
export async function resolveAccount(
  deps: PaystackDeps,
  input: { bankCode: string; accountNumber: string },
): Promise<{ accountName: string }> {
  if (!/^\d{10}$/.test(input.accountNumber)) {
    throw new RelayerError("BAD_REQUEST", "A Nigerian account number is 10 digits.");
  }

  const data = (await call(
    deps,
    `/bank/resolve?account_number=${input.accountNumber}&bank_code=${encodeURIComponent(input.bankCode)}`,
  )) as { account_name?: string };

  if (!data.account_name) {
    throw new RelayerError("ACCOUNT_NOT_RESOLVED", "That account could not be found.");
  }
  return { accountName: data.account_name };
}

const COUNTRY_FOR_CURRENCY: Record<string, string> = {
  NGN: "nigeria",
  GHS: "ghana",
  KES: "kenya",
  ZAR: "south africa",
};
