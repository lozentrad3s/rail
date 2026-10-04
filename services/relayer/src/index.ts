/**
 * rail-relayer — the sender-facing API.
 *
 * It quotes a transfer, submits the order the sender signed, and tells the winning provider where
 * to send the money. It holds MON for gas and nothing else: it cannot move a sender's dollars,
 * cannot alter what they agreed to, and if it disappears the escrow still settles or refunds
 * because `finalize` and `refund` are permissionless.
 */
import { createServer } from "node:http";

import { createPublicClient, createWalletClient, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { createAccountLink, getLinkedAccount, linkAccount } from "./accounts.ts";
import { loadConfig } from "./config.ts";
import { createContactLink, forgetContact, listContacts, saveContact } from "./contacts.ts";
import { createDraft, readDraft } from "./drafts.ts";
import { RelayerError } from "./errors.ts";
import { assertSaneFallback, currentRate } from "./fx.ts";
import { Router } from "./http.ts";
import { SubmissionQueue } from "./nonce.ts";
import { createOrder, payoutDetails, readOrder, type OrderDeps } from "./orders.ts";
import { listBanks, resolveAccount } from "./paystack.ts";
import { priceTransfer } from "./quote.ts";
import { RecipientStore } from "./recipients.ts";
import { currencyToBytes3 } from "./rail.ts";
import { Vault } from "./vault.ts";

const config = loadConfig();
assertSaneFallback(config.fallbackRate);
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

const vault = new Vault(process.env.VAULT_DIR ?? ".vault", config.recipientKey);
const paystack = { secretKey: config.paystackSecretKey };

/**
 * The bot's own endpoints are behind a shared secret.
 *
 * It is not much of a secret — but the bot can only ever draft, so the worst an attacker with it
 * can do is propose payments that a sender will decline. Nothing here signs anything.
 */
function requireBot(request: { headers: Record<string, string | string[] | undefined> }): void {
  if (!config.botApiKey) throw new RelayerError("UNAUTHORIZED", "Bot access is not configured.");
  const header = request.headers.authorization;
  const presented = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
  if (presented !== config.botApiKey) throw new RelayerError("UNAUTHORIZED", "Bad credentials.");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RelayerError("BAD_REQUEST", `${field} is required.`);
  }
  return value.trim();
}

const router = new Router({ allowedOrigins: config.allowedOrigins })
  /**
   * Something sensible for a person who opens this URL in a browser.
   *
   * It used to answer `{"error":{"code":"NOT_FOUND"}}`, which is correct for an API and reads as
   * broken to anyone who was handed the link. The service is not the product, so it says where the
   * product is.
   */
  .get("/", async () => ({
    service: "rail-relayer",
    ok: true,
    app: "https://rail-pay.vercel.app",
    chat: "https://t.me/RailpayBot",
    note: "This is Rail's relayer API. It quotes transfers and submits the orders senders sign. It never holds anyone's money, and settlement does not depend on it: finalize and refund are permissionless.",
    endpoints: ["GET /healthz", "GET /v1/quote", "GET /v1/banks", "POST /v1/orders", "GET /v1/orders/:orderId"],
  }))

  .get("/healthz", async () => ({ ok: true }))

  .get("/v1/banks", async ({ query }) => {
    const currency = (query.get("currency") ?? "NGN").toUpperCase();
    return listBanks(paystack, currency);
  })

  .get("/v1/accounts/resolve", async ({ query }) => {
    const bankCode = requireString(query.get("bankCode"), "bankCode");
    const accountNumber = requireString(query.get("accountNumber"), "accountNumber");
    return resolveAccount(paystack, { bankCode, accountNumber });
  })

  // The bot asks for a link instead of asking for an account number in chat.
  .post("/v1/contact-links", async ({ body, request }) => {
    requireBot(request);
    const input = (body ?? {}) as Record<string, unknown>;
    return createContactLink(
      vault,
      { waId: requireString(input.waId, "waId"), contactName: requireString(input.contactName, "contactName") },
      config.appBaseUrl,
    );
  })

  // Used by the app, not the bot: the link itself is the authorisation.
  .post("/v1/contacts", async ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const bankCode = requireString(input.bankCode, "bankCode");
    const accountNumber = requireString(input.accountNumber, "accountNumber");
    const currency = requireString(input.currency, "currency").toUpperCase();

    // The name is resolved here rather than trusted from the client, so the sender sees who the
    // bank says owns this account.
    const [{ accountName }, banks] = await Promise.all([
      resolveAccount(paystack, { bankCode, accountNumber }),
      listBanks(paystack, currency).catch(() => []),
    ]);

    return saveContact(vault, {
      token: requireString(input.token, "token"),
      currency,
      bankCode,
      bankName: banks.find((bank) => bank.code === bankCode)?.name ?? bankCode,
      accountNumber,
      accountName,
    });
  })

  .get("/v1/contacts", async ({ query, request }) => {
    requireBot(request);
    return listContacts(vault, requireString(query.get("waId"), "waId"));
  })

  // Scoped to the chat that owns the contact: the key is derived from the chat id.
  .post("/v1/contacts/forget", async ({ body, request }) => {
    requireBot(request);
    const input = (body ?? {}) as Record<string, unknown>;
    return forgetContact(
      vault,
      requireString(input.waId, "waId"),
      requireString(input.contactId, "contactId"),
    );
  })

  // A number is bound to an account only by a signature from that account.
  .post("/v1/account-links", async ({ body, request }) => {
    requireBot(request);
    const input = (body ?? {}) as Record<string, unknown>;
    return createAccountLink(vault, requireString(input.waId, "waId"), config.appBaseUrl);
  })

  // Used by the app. The signature is the authorisation; there is no bot key here.
  .post("/v1/accounts/link", async ({ body }) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const address = requireString(input.address, "address");
    if (!isAddress(address)) throw new RelayerError("BAD_REQUEST", "address is not an address.");

    const { waId, address: linked } = await linkAccount(vault, {
      token: requireString(input.token, "token"),
      address,
      signature: requireString(input.signature, "signature") as Hex,
    });
    return { waId, address: linked };
  })

  .get("/v1/accounts", async ({ query, request }) => {
    requireBot(request);
    const linked = getLinkedAccount(vault, requireString(query.get("waId"), "waId"));
    if (!linked) throw new RelayerError("NOT_FOUND", "This number has no account yet.");
    return { address: linked.address };
  })

  .post("/v1/drafts", async ({ body, request }) => {
    requireBot(request);
    const input = (body ?? {}) as Record<string, unknown>;
    let localAmount: bigint;
    try {
      localAmount = BigInt(requireString(input.localAmount, "localAmount"));
    } catch {
      throw new RelayerError("BAD_REQUEST", "localAmount must be a whole number of minor units.");
    }

    return createDraft(
      vault,
      {
        waId: requireString(input.waId, "waId"),
        contactId: requireString(input.contactId, "contactId"),
        currency: requireString(input.currency, "currency").toUpperCase(),
        localAmount,
      },
      config.appBaseUrl,
    );
  })

  // Opened by the app. The full account number appears here and nowhere else.
  .get("/v1/drafts/:draftId", async ({ params }) => readDraft(vault, params.draftId ?? ""))

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

    // Live, because a stale rate quotes a ceiling no provider can fill and the order just refunds.
    const { rate, source } = await currentRate(
      { url: config.fxUrl, fallback: config.fallbackRate },
      currency,
    );

    const quote = priceTransfer({
      currency,
      localAmountMinor: localAmount,
      rate,
      reserveBufferBps: config.reserveBufferBps,
      feeAusd: config.feeAusd,
      ttlSeconds: config.quoteTtlSeconds,
    });

    return {
      ...quote,
      rateSource: source,
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
