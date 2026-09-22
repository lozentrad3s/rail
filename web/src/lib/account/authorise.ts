/**
 * The one signature a sender gives.
 *
 * Everything the sender agreed to — who is paid, how much, in what currency, which attestor — is
 * hashed into the order id, and that id *is* the authorisation nonce. So the relayer cannot change
 * a single field without invalidating the signature it is carrying (invariant 9). It pays the fee
 * and can alter nothing.
 *
 * Kept under `lib/account` because `(sender)` and `components/sender` must stay clean against the
 * ban list in CLAUDE.md — see docs/INTERFACES.md §5.5.1.
 */
import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import { CHAIN_ID, client, ESCROW, SETTLEMENT_ASSET } from "./chain";
import type { TransferSigner } from "./signer";

/** Long enough to walk from the chat to the app, short enough that a stale price is not signed. */
const VALID_FOR_SECONDS = 600;
/** Clock skew between a phone and a node is real; a signature valid "from now" can arrive too early. */
const BACKDATE_SECONDS = 60;

export type Terms = {
  /** Three-letter currency, already packed by the relayer. */
  currencyBytes3: Hex;
  localAmount: bigint;
  maxAusd: bigint;
  fee: bigint;
  relayer: Address;
  attestor: Address;
};

export type Recipient = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

/** Exactly what `POST /v1/orders` expects — docs/INTERFACES.md §5.1. */
export type SignedOrder = {
  intent: Record<string, string>;
  authorization: { validAfter: string; validBefore: string; v: string; r: string; s: string };
  recipient: Recipient & { salt: Hex };
};

const randomSalt = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;

const hashIntentAbi = parseAbi([
  "struct OrderIntent { address sender; bytes32 recipientCommitment; bytes3 currency; uint256 localAmount; uint256 maxAusd; uint256 fee; address relayer; address attestor; bytes32 salt; }",
  "function hashIntent(OrderIntent intent) view returns (bytes32)",
]);

const domainAbi = parseAbi([
  "function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])",
]);

/**
 * Signs the transfer and returns the body the relayer submits.
 *
 * Nothing is sent from here. The caller decides whether to hand it over, and until it does, the
 * signature authorises a transfer that has not happened.
 */
export async function authoriseTransfer(input: {
  signer: TransferSigner;
  terms: Terms;
  recipient: Recipient;
}): Promise<SignedOrder> {
  const { signer, terms, recipient } = input;
  // Whoever the signer is, the order is bound to its address and nobody else can spend against it.
  const address = signer.address;

  // The bank details never reach the chain. A salted hash does, and the salt is 32 bytes because a
  // ten-digit account number without one is brute-forced in seconds (invariant 3).
  const salt = randomSalt();
  const recipientCommitment = keccak256(
    encodeAbiParameters(parseAbiParameters("string, string, bytes32"), [
      recipient.bankCode,
      recipient.accountNumber,
      salt,
    ]),
  );

  const intent = {
    sender: address,
    recipientCommitment,
    currency: terms.currencyBytes3,
    localAmount: terms.localAmount,
    maxAusd: terms.maxAusd,
    fee: terms.fee,
    relayer: terms.relayer,
    attestor: terms.attestor,
    salt: randomSalt(),
  };

  // The order id is the hash of all of it, and it doubles as the authorisation nonce.
  const orderId = await client.readContract({
    address: ESCROW,
    abi: hashIntentAbi,
    functionName: "hashIntent",
    args: [intent],
  });

  // The domain is read from the asset itself, never hardcoded: a wrong domain is a signature that
  // verifies nowhere, discovered at the worst moment.
  const [, name, version] = await client.readContract({
    address: SETTLEMENT_ASSET,
    abi: domainAbi,
    functionName: "eip712Domain",
  });

  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(now - BACKDATE_SECONDS);
  const validBefore = BigInt(now + VALID_FOR_SECONDS);

  const signature = await signer.sign({
    domain: { name, version, chainId: CHAIN_ID, verifyingContract: SETTLEMENT_ASSET },
    message: {
      from: address,
      // `receiveWithAuthorization`, never `transferWithAuthorization`: the latter is front-runnable.
      to: ESCROW,
      value: terms.maxAusd + terms.fee,
      validAfter,
      validBefore,
      nonce: orderId,
    },
  });

  return {
    intent: {
      sender: intent.sender,
      recipientCommitment: intent.recipientCommitment,
      currency: intent.currency,
      localAmount: intent.localAmount.toString(),
      maxAusd: intent.maxAusd.toString(),
      fee: intent.fee.toString(),
      relayer: intent.relayer,
      attestor: intent.attestor,
      salt: intent.salt,
    },
    authorization: {
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      v: BigInt(`0x${signature.slice(130, 132)}`).toString(),
      r: signature.slice(0, 66),
      s: `0x${signature.slice(66, 130)}`,
    },
    recipient: { ...recipient, salt },
  };
}
