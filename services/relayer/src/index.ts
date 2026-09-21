/**
 * rail-relayer — the sender-facing API.
 *
 * It quotes a transfer, submits the order the sender signed, and tells the winning provider where
 * to send the money. It holds MON for gas and nothing else: it cannot move a sender's dollars,
 * cannot alter what they agreed to, and if it disappears the escrow still settles or refunds
 * because `finalize` and `refund` are permissionless.
 */
import { createServer } from "node:http";

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { loadConfig } from "./config.ts";
import { RelayerError } from "./errors.ts";
import { Router } from "./http.ts";
import { SubmissionQueue } from "./nonce.ts";
import { createOrder, payoutDetails, readOrder, type OrderDeps } from "./orders.ts";
import { priceTransfer } from "./quote.ts";
import { RecipientStore } from "./recipients.ts";
import { currencyToBytes3 } from "./rail.ts";

const config = loadConfig();
const account = privateKeyToAccount(config.relayerKey);

// A call with no deadline can wedge a request handler against a rate-limited node.
const transport = http(config.rpcUrl, { timeout: 10_000, retryCount: 2, retryDelay: 200 });
const publicClient = createPublicClient({ chain: monadTestnet, transport });
const walletClient = createWalletClient({ account, chain: monadTestnet, transport });

const deps: OrderDeps = {
  publicClient,
  walletClient,
  account,
  config,
  recipients: new RecipientStore(process.env.RECIPIENT_DIR ?? ".recipients", config.recipientKey),
  queue: new SubmissionQueue(() =>
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  ),
};

const router = new Router()
  .get("/healthz", async () => ({ ok: true }))

  .get("/v1/quote", async ({ query }) => {
    const currency = (query.get("currency") ?? "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new RelayerError("BAD_REQUEST", "currency must be a three-letter code.");
    }

    let localAmount: bigint;
    try {
      localAmount = BigInt(query.get("localAmount") ?? "");
    } catch {
      throw new RelayerError("BAD_REQUEST", "localAmount must be a whole number of minor units.");
    }
    if (localAmount <= 0n) throw new RelayerError("BAD_REQUEST", "localAmount must be positive.");

    const quote = priceTransfer({
      currency,
      localAmountMinor: localAmount,
      // Until there are settled orders to price from, the configured rate stands in.
      rate: config.fallbackRate,
      reserveBufferBps: config.reserveBufferBps,
      feeAusd: config.feeAusd,
      ttlSeconds: config.quoteTtlSeconds,
    });

    return {
      ...quote,
      currencyBytes3: currencyToBytes3(currency),
      relayer: account.address,
      attestor: config.attestor,
    };
  })

  .post("/v1/orders", async ({ body }) => createOrder(deps, body))

  .get("/v1/orders/:orderId", async ({ params }) => {
    const orderId = params.orderId ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) {
      throw new RelayerError("BAD_REQUEST", "orderId must be a 32-byte hex string.");
    }
    return readOrder(deps, orderId as Hex);
  })

  .post("/v1/orders/:orderId/payout-details", async ({ params, body }) => {
    const orderId = params.orderId ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) {
      throw new RelayerError("BAD_REQUEST", "orderId must be a 32-byte hex string.");
    }
    return payoutDetails(deps, orderId as Hex, body);
  });

const server = createServer((request, response) => {
  void router.handle(request, response);
});

server.listen(config.port, () => {
  console.log(
    `${new Date().toISOString()} relayer listening port=${config.port} signer=${account.address} core=${config.railCore}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${new Date().toISOString()} stopping`);
    server.close(() => process.exit(0));
  });
}
