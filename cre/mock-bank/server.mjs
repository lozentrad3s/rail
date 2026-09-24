/**
 * A stand-in for the bank aggregator, for simulation only.
 *
 * CRE simulation makes real HTTP calls, so the workflow needs something real to call. Mono and
 * Paystack both report credits into an account; this serves the same shape from a fixture, so the
 * workflow can be exercised against a payout that landed, one that didn't, one that was short, and
 * an outage — none of which are convenient to arrange with a real bank.
 *
 *   node cre/mock-bank/server.mjs            # port 8795
 *   PORT=9000 SCENARIO=short node ...        # other cases
 *
 * SCENARIO: paid (default) · missing · short · pending · outage
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8795);
const SCENARIO = process.env.SCENARIO ?? "paid";

/** ₦50,000 in kobo — the amount every Rail demo sends. */
const FIFTY_THOUSAND_NAIRA = "5000000";

const credit = (overrides = {}) => ({
  reference: "MONO-CR-8841207",
  narration: "RAILA8BEFD38",
  amountMinor: FIFTY_THOUSAND_NAIRA,
  currency: "NGN",
  status: "successful",
  ...overrides,
});

const SCENARIOS = {
  // The payout landed exactly as promised.
  paid: () => ({ credits: [credit()] }),
  // Nothing with that reference. The provider has not paid, or not yet.
  missing: () => ({ credits: [] }),
  // Right reference, not enough money. Must not attest.
  short: () => ({ credits: [credit({ amountMinor: "4000000" })] }),
  // Bank has seen it but not settled it. Must not attest.
  pending: () => ({ credits: [credit({ status: "pending" })] }),
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const narration = url.searchParams.get("narration") ?? "";

  if (SCENARIO === "outage") {
    // A node that cannot reach the bank must abstain, not vote "not paid".
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "upstream unavailable" }));
    console.log(`${request.method} ${url.pathname}${url.search} -> 503 (outage)`);
    return;
  }

  const build = SCENARIOS[SCENARIO] ?? SCENARIOS.paid;
  const body = build();

  // Only credits matching the narration the caller asked about, the way a real query would.
  const credits = body.credits.filter(
    (entry) => entry.narration.toUpperCase() === narration.toUpperCase(),
  );

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ credits }));
  console.log(
    `${request.method} ${url.pathname}${url.search} -> 200 (${SCENARIO}, ${credits.length} credit(s))`,
  );
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock bank listening on http://127.0.0.1:${PORT} scenario=${SCENARIO}`);
});
