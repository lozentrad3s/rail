/**
 * Creating and reading orders.
 *
 * The relayer pays the gas and nothing else. It cannot alter what the sender agreed to: every
 * field of the intent is bound into the EIP-3009 nonce, so changing the recipient, the amount, the
 * currency, the fee or the attestor produces a different nonce and the token rejects the
 * signature. These checks exist to fail early and legibly, not because the chain needs them.
 */
import {
  hashTypedData,
  recoverMessageAddress,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import type { Config } from "./config.ts";
import { RelayerError } from "./errors.ts";
import type { SubmissionQueue } from "./nonce.ts";
import { commitmentFor, type Recipient, type RecipientStore } from "./recipients.ts";
import {
  ausdAbi,
  CREATE_ORDER_GAS,
  currencyFromBytes3,
  railCoreAbi,
  STATUS_NAMES,
  type Authorization,
  type OrderIntent,
} from "./rail.ts";

/** How stale a provider's signed request for payout details may be. */
const PAYOUT_AUTH_WINDOW_SECONDS = 120;

export type OrderDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  /**
   * The signing account itself, not its address. Given an address, viem treats the signer as a
   * remote JSON-RPC account and asks the node to sign — a method a public RPC does not implement.
   */
  account: Account;
  config: Config;
  recipients: RecipientStore;
  queue: SubmissionQueue;
};

/**
 * The order id: the EIP-712 hash of the intent, which is also the authorisation nonce (docs §3.2).
 *
 * Computed here rather than asked of the chain, so a submission costs one round trip instead of
 * two. `RailCore.hashIntent` returns the same value, and a contract test asserts it.
 */
export function orderIdFor(intent: OrderIntent, chainId: number, railCore: Address): Hex {
  return hashTypedData({
    domain: { name: "Rail", version: "1", chainId, verifyingContract: railCore },
    types: {
      OrderIntent: [
        { name: "sender", type: "address" },
        { name: "recipientCommitment", type: "bytes32" },
        { name: "currency", type: "bytes3" },
        { name: "localAmount", type: "uint256" },
        { name: "maxAusd", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "relayer", type: "address" },
        { name: "attestor", type: "address" },
        { name: "salt", type: "bytes32" },
      ],
    },
    primaryType: "OrderIntent",
    message: intent,
  });
}

/**
 * The reference a provider puts in the bank transfer, e.g. `RAILA8F2C3D1`.
 *
 * Twelve characters, alphanumeric only, because banks strip punctuation and truncate narration.
 */
export function narrationFor(orderId: Hex): string {
  return `RAIL${orderId.slice(2, 10).toUpperCase()}`;
}

export async function createOrder(deps: OrderDeps, body: unknown): Promise<{ orderId: Hex; txHash: Hex }> {
  const { intent, authorization, recipient } = parseCreateBody(body);
  const { publicClient, walletClient, account, config, recipients, queue } = deps;

  const orderId = orderIdFor(intent, await publicClient.getChainId(), config.railCore);

  // The bank details must be the ones the sender hashed. If they are not, the provider would be
  // paid to send money to an account the sender never agreed to.
  if (commitmentFor(recipient).toLowerCase() !== intent.recipientCommitment.toLowerCase()) {
    throw new RelayerError(
      "COMMITMENT_MISMATCH",
      "These bank details do not match what was signed.",
    );
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (authorization.validBefore <= now + 10n) {
    throw new RelayerError("QUOTE_EXPIRED", "This quote has expired. Please get a new one.");
  }

  /**
   * Checked separately from the simulation, which would also catch it.
   *
   * It is the single most likely reason a transfer cannot go through — somebody linked an account
   * and asked to send more than it holds — and as a simulation revert it arrives as "this transfer
   * would not go through", which tells them nothing they can act on. Read once and named, it
   * becomes "you need $17.65 more", which they can fix.
   */
  const required = intent.maxAusd + intent.fee;
  const available = await publicClient.readContract({
    address: config.ausd,
    abi: ausdAbi,
    functionName: "balanceOf",
    args: [intent.sender],
  });
  if (available < required) {
    throw new RelayerError(
      "INSUFFICIENT_BALANCE",
      "There isn't enough in that account to cover this transfer.",
      { data: { required: required.toString(), available: available.toString() } },
    );
  }

  // Simulate before spending gas: a revert here is the sender's problem to see, not a failed
  // transaction they paid for.
  try {
    await publicClient.simulateContract({
      address: config.railCore,
      abi: railCoreAbi,
      functionName: "createOrder",
      args: [intent, authorization],
      account,
    });
  } catch (cause) {
    throw new RelayerError("SIMULATION_FAILED", "This transfer would not go through.", { cause });
  }

  // Stored before submitting: if the order lands and we have lost the bank details, the provider
  // cannot be told where to pay and the money sits in escrow until it refunds.
  recipients.put(orderId, recipient);

  const txHash = await queue.submit((nonce) =>
    walletClient.writeContract({
      address: config.railCore,
      abi: railCoreAbi,
      functionName: "createOrder",
      args: [intent, authorization],
      account,
      chain: null,
      // Monad charges the declared limit, so this is measured, not estimated per call.
      gas: CREATE_ORDER_GAS,
      nonce,
    }),
  ).catch((cause) => {
    // Operational, not the sender's fault: log the real reason here, return a plain one to them.
    console.error(`${new Date().toISOString()} submission-failed order=${orderId}`, cause);
    throw new RelayerError("SUBMISSION_FAILED", "Could not submit the transfer. Try again.", { cause });
  });

  // Returned without waiting for inclusion: the app polls the order, and a slow block should not
  // look like a failure to the sender.
  return { orderId, txHash };
}

/**
 * What an account holds, so the app can say so before anybody approves anything.
 *
 * Read here rather than in the browser because the app has no RPC of its own worth relying on — the
 * public endpoint rate-limits and caps log scans, and a dashboard that silently reads nothing is
 * worse than one that reads nothing loudly. Returned as a decimal string: `JSON.stringify` cannot
 * serialise a `bigint`, and a `number` loses precision past about $9 billion.
 */
export async function readBalance(
  deps: OrderDeps,
  address: string,
): Promise<{ address: Address; balance: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new RelayerError("BAD_REQUEST", "address must be a 20-byte hex string.");
  }

  const balance = await deps.publicClient
    .readContract({
      address: deps.config.ausd,
      abi: ausdAbi,
      functionName: "balanceOf",
      args: [address as Address],
    })
    .catch((cause: unknown) => {
      throw new RelayerError("INTERNAL", "Could not read that balance right now.", { cause });
    });

  return { address: address as Address, balance: balance.toString() };
}

export async function readOrder(deps: OrderDeps, orderId: Hex) {
  const order = await deps.publicClient.readContract({
    address: deps.config.railCore,
    abi: railCoreAbi,
    functionName: "getOrder",
    args: [orderId],
  });

  if (order.status === 0) throw new RelayerError("NOT_FOUND", "No such transfer.");

  return {
    orderId,
    status: STATUS_NAMES[order.status] ?? "Unknown",
    currency: currencyFromBytes3(order.currency),
    localAmount: order.localAmount,
    maxAusd: order.maxAusd,
    winner: order.winner === "0x0000000000000000000000000000000000000000" ? null : order.winner,
    winningBid: order.winningBid,
    /** What comes back to the sender if it settles at the current winning bid. */
    change: order.winningBid > 0n ? order.maxAusd - order.winningBid : null,
    narration: narrationFor(orderId),
    blocks: {
      commitEnd: order.commitEnd,
      revealEnd: order.revealEnd,
      payoutDeadline: order.payoutDeadline,
      disputeEnd: order.disputeEnd,
      resolutionEnd: order.resolutionEnd,
    },
  };
}

/**
 * Gives the winning provider the bank details, and nobody else.
 *
 * Authentication is a signature from the address the chain says won, over a message naming the
 * order and the moment. There is no session and no API key: the right to see these details comes
 * from having won the auction.
 */
export async function payoutDetails(deps: OrderDeps, orderId: Hex, body: unknown) {
  const { lp, issuedAt, signature } = parsePayoutBody(body);

  const drift = Math.abs(Math.floor(Date.now() / 1000) - issuedAt);
  if (drift > PAYOUT_AUTH_WINDOW_SECONDS) {
    throw new RelayerError("UNAUTHORIZED", "This request is too old.");
  }

  const message = `Rail payout details\norder: ${orderId}\nissuedAt: ${issuedAt}`;
  const recovered = await recoverMessageAddress({ message, signature }).catch(() => undefined);
  if (!recovered || recovered.toLowerCase() !== lp.toLowerCase()) {
    throw new RelayerError("UNAUTHORIZED", "Signature does not match.");
  }

  const order = await deps.publicClient.readContract({
    address: deps.config.railCore,
    abi: railCoreAbi,
    functionName: "getOrder",
    args: [orderId],
  });

  const live = order.status === 2 || order.status === 3 || order.status === 4;
  if (!live || order.winner.toLowerCase() !== recovered.toLowerCase()) {
    throw new RelayerError("NOT_WINNER", "You are not the provider for this transfer.");
  }

  const recipient = deps.recipients.get(orderId);
  if (!recipient) throw new RelayerError("NOT_FOUND", "No recipient details for this transfer.");

  return {
    bankCode: recipient.bankCode,
    accountNumber: recipient.accountNumber,
    accountName: recipient.accountName,
    currency: currencyFromBytes3(order.currency),
    localAmount: order.localAmount,
    narration: narrationFor(orderId),
  };
}

/*//////////////////////////////////////////////////////////////
                             PARSING
//////////////////////////////////////////////////////////////*/

function parseCreateBody(body: unknown): {
  intent: OrderIntent;
  authorization: Authorization;
  recipient: Recipient;
} {
  const input = expectObject(body);
  const intent = expectObject(input.intent, "intent");
  const authorization = expectObject(input.authorization, "authorization");
  const recipient = expectObject(input.recipient, "recipient");

  return {
    intent: {
      sender: expectHex(intent.sender, "intent.sender") as Address,
      recipientCommitment: expectHex(intent.recipientCommitment, "intent.recipientCommitment"),
      currency: expectHex(intent.currency, "intent.currency"),
      localAmount: expectBigInt(intent.localAmount, "intent.localAmount"),
      maxAusd: expectBigInt(intent.maxAusd, "intent.maxAusd"),
      fee: expectBigInt(intent.fee, "intent.fee"),
      relayer: expectHex(intent.relayer, "intent.relayer") as Address,
      attestor: expectHex(intent.attestor, "intent.attestor") as Address,
      salt: expectHex(intent.salt, "intent.salt"),
    },
    authorization: {
      validAfter: expectBigInt(authorization.validAfter, "authorization.validAfter"),
      validBefore: expectBigInt(authorization.validBefore, "authorization.validBefore"),
      v: Number(expectBigInt(authorization.v, "authorization.v")),
      r: expectHex(authorization.r, "authorization.r"),
      s: expectHex(authorization.s, "authorization.s"),
    },
    recipient: {
      bankCode: expectString(recipient.bankCode, "recipient.bankCode"),
      accountNumber: expectString(recipient.accountNumber, "recipient.accountNumber"),
      accountName: expectString(recipient.accountName, "recipient.accountName"),
      salt: expectHex(recipient.salt, "recipient.salt"),
    },
  };
}

function parsePayoutBody(body: unknown): { lp: Address; issuedAt: number; signature: Hex } {
  const input = expectObject(body);
  return {
    lp: expectHex(input.lp, "lp") as Address,
    issuedAt: Number(expectBigInt(input.issuedAt, "issuedAt")),
    signature: expectHex(input.signature, "signature"),
  };
}

function expectObject(value: unknown, field = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayerError("BAD_REQUEST", `${field} is missing or malformed.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RelayerError("BAD_REQUEST", `${field} is missing.`);
  }
  return value;
}

function expectHex(value: unknown, field: string): Hex {
  const text = expectString(value, field);
  if (!/^0x[0-9a-fA-F]*$/.test(text)) throw new RelayerError("BAD_REQUEST", `${field} is not hex.`);
  return text as Hex;
}

/** Amounts arrive as decimal strings, never as JSON numbers, so nothing is lost to a float. */
function expectBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  const text = expectString(value, field);
  try {
    return BigInt(text);
  } catch {
    throw new RelayerError("BAD_REQUEST", `${field} is not a whole number.`);
  }
}
