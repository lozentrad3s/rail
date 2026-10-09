/**
 * payout-attestor logic — does the naira actually exist in the recipient's account?
 *
 * Rail's escrow releases when a payout is attested. Today that attestation comes from a single
 * signer, which is the weakest part of the whole design: one key, one machine, one person who could
 * be wrong or bought. This workflow replaces it with a DON that checks the bank independently and
 * only speaks when every node agrees.
 *
 * The safety property that makes this shape acceptable at all (Rail invariant 8): an attestor can
 * only ever *accelerate* settlement, never block it. If this workflow is down, disagrees with
 * itself, or is never deployed, `RailCore`'s optimistic window still settles the order on its own.
 * So the failure mode of a decentralised attestor is "slower", never "stuck" — which is why
 * `identical` consensus is the right choice below even though it is the strictest one available.
 */
/*
 * Kept apart from main.ts because the WASM compiler (javy) refuses an entry module that exports a
 * function taking parameters, and every function here takes some. The tests import from here; the
 * entry exports only `main`.
 */
import {
  consensusIdenticalAggregation,
  decodeJson,
  handler,
  HTTPCapability,
  HTTPClient,
  json,
  ok,
  type HTTPPayload,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";

export type Config = {
  /** Where a credit into the provider's own account can be looked up. */
  bankApiUrl: string;
  /**
   * Keys permitted to invoke this workflow once deployed. Empty accepts anyone, which is fine in
   * simulation and must never ship: a public attestation endpoint anyone can call is an oracle
   * anyone can ask leading questions of.
   *
   * Mirrors the SDK's AuthorizedKeyJson, which the package does not re-export from its index.
   */
  authorizedKeys: { type?: "KEY_TYPE_UNSPECIFIED" | "KEY_TYPE_ECDSA_EVM"; publicKey?: string }[];
  /** Name of the Vault DON secret holding the bank aggregator's key. Absent in simulation. */
  bankApiKeySecretId?: string;
};

/**
 * What the caller claims happened.
 *
 * `narration` is the reference `RailCore` generated for this order — `RAILA8BEFD38` and the like.
 * It is the only thing tying a bank credit to an escrowed order, which is why the workflow matches
 * on it rather than on amount alone: two senders paying the same amount on the same day would
 * otherwise be indistinguishable.
 */
const requestSchema = z.object({
  orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "orderId must be a 32-byte hex string"),
  narration: z.string().min(4).max(64),
  currency: z.string().length(3),
  /** Minor units — kobo for naira. A string, because JSON numbers lose precision. */
  expectedMinor: z.string().regex(/^[0-9]+$/, "expectedMinor must be digits"),
});

/** One credit as the aggregator reports it. Extra fields are ignored rather than rejected. */
const creditSchema = z.object({
  reference: z.string(),
  narration: z.string(),
  amountMinor: z.union([z.string(), z.number()]),
  currency: z.string(),
  status: z.string(),
});

const creditsSchema = z.object({ credits: z.array(creditSchema) });

export type Credit = z.infer<typeof creditSchema>;

/**
 * Does any of these credits discharge this obligation?
 *
 * Separated from the HTTP call because this is the part that must be right. Every clause below is
 * somebody keeping or losing money, and each is tested directly in main.test.ts.
 */
export function matchCredit(
  credits: Credit[],
  wanted: { narration: string; currency: string; expectedMinor: string },
): Credit | undefined {
  const owed = BigInt(wanted.expectedMinor);
  const reference = wanted.narration.trim().toUpperCase();

  return credits.find((credit) => {
    // Anything the bank has not settled is not a payment yet. "pending" can still be reversed.
    if (credit.status.toLowerCase() !== "successful") return false;
    // Case and stray whitespace are the bank's, not the sender's, so normalise both sides.
    if (credit.narration.trim().toUpperCase() !== reference) return false;
    if (credit.currency.toUpperCase() !== wanted.currency.toUpperCase()) return false;
    // At least what is owed. Overpaying still discharges it; underpaying does not.
    return BigInt(credit.amountMinor) >= owed;
  });
}

/** The one string the nodes must agree on, byte for byte. */
type Verdict = string;
const PAID = (reference: string): Verdict => `paid:${reference}`;
const NOT_PAID: Verdict = "not-paid";

/**
 * One node's independent look at the bank.
 *
 * Runs per node, so each one reaches the aggregator itself rather than trusting a value another
 * node computed. Everything it returns is derived only from what the bank said, so two honest nodes
 * looking at the same settled credit produce the same string.
 */
const checkBank = (
  nodeRuntime: NodeRuntime<Config>,
  narration: string,
  currency: string,
  expectedMinor: string,
  apiKey: string,
): Verdict => {
  const httpClient = new HTTPClient();

  const query = `?narration=${encodeURIComponent(narration)}&currency=${encodeURIComponent(currency)}`;
  const response = httpClient
    .sendRequest(nodeRuntime, {
      url: `${nodeRuntime.config.bankApiUrl}${query}`,
      method: "GET",
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    })
    .result();

  if (!ok(response)) {
    // A node that cannot see the bank must not vote "not paid" — that is a different claim from
    // "the bank says there is no credit", and conflating them would attest a default that never
    // happened. Throwing makes this node abstain, and consensus decides without it.
    throw new Error(`bank lookup failed: HTTP ${response.statusCode}`);
  }

  const { credits } = creditsSchema.parse(json(response));
  const match = matchCredit(credits, { narration, currency, expectedMinor });

  return match ? PAID(match.reference) : NOT_PAID;
};

export const onAttestationRequest = (
  runtime: Runtime<Config>,
  triggerEvent: HTTPPayload,
): string => {
  // The trigger carries raw bytes, not a parsed object — `input`, not `body`, on SDK 1.22.
  const request = requestSchema.parse(decodeJson(triggerEvent.input));

  // Secrets are read here, in DON mode: node mode cannot reach them (see http-client.md).
  const apiKey = runtime.config.bankApiKeySecretId
    ? runtime.getSecret({ id: runtime.config.bankApiKeySecretId }).result().value
    : "";

  /**
   * `identical`, not majority.
   *
   * Every node must return the same string or there is no attestation. That is deliberately the
   * strictest option, and it is only safe because of invariant 8: disagreement means the order
   * falls back to the optimistic window and settles a little later. Nobody's money is stuck, so
   * the correct bias is to say nothing unless the DON is unanimous.
   */
  const verdict = runtime
    .runInNodeMode(checkBank, consensusIdenticalAggregation<Verdict>())(
      request.narration,
      request.currency,
      request.expectedMinor,
      apiKey,
    )
    .result();

  const paid = verdict.startsWith("paid:");
  runtime.log(
    `order=${request.orderId} narration=${request.narration} verdict=${paid ? "paid" : "not-paid"}`,
  );

  return JSON.stringify({
    orderId: request.orderId,
    attested: paid,
    bankReference: paid ? verdict.slice("paid:".length) : null,
    checkedAt: runtime.now().toISOString(),
  });
};

export const initWorkflow = (config: Config) => {
  const http = new HTTPCapability();

  return [handler(http.trigger({ authorizedKeys: config.authorizedKeys }), onAttestationRequest)];
};
