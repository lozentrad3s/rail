/** The slice of Rail the relayer touches, plus the typed data a sender signs. */
import { parseAbi, type Address, type Hex } from "viem";

export const railCoreAbi = parseAbi([
  "struct OrderIntent { address sender; bytes32 recipientCommitment; bytes3 currency; uint256 localAmount; uint256 maxAusd; uint256 fee; address relayer; address attestor; bytes32 salt; }",
  "struct Authorization { uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }",
  "struct Order { address sender; uint8 status; bytes3 currency; uint64 commitEnd; address winner; uint64 revealEnd; address attestor; uint64 payoutDeadline; uint128 maxAusd; uint128 winningBid; bytes32 recipientCommitment; uint256 localAmount; uint64 disputeEnd; uint64 resolutionEnd; }",
  "function createOrder(OrderIntent intent, Authorization authorization) returns (bytes32)",
  "function hashIntent(OrderIntent intent) view returns (bytes32)",
  "function getOrder(bytes32 orderId) view returns (Order)",
  "function dispute(bytes32 orderId, bytes signature)",
]);

/** Measured with `forge test --gas-report`: createOrder max 273,180. */
export const CREATE_ORDER_GAS = 400_000n;

export const STATUS_NAMES = [
  "None",
  "Open",
  "Awarded",
  "Paid",
  "Disputed",
  "Settled",
  "Refunded",
  "Cancelled",
] as const;

export type OrderIntent = {
  sender: Address;
  recipientCommitment: Hex;
  currency: Hex;
  localAmount: bigint;
  maxAusd: bigint;
  fee: bigint;
  relayer: Address;
  attestor: Address;
  salt: Hex;
};

export type Authorization = {
  validAfter: bigint;
  validBefore: bigint;
  v: number;
  r: Hex;
  s: Hex;
};

/** ISO code to the on-chain `bytes3`, e.g. NGN → 0x4e474e. */
export function currencyToBytes3(code: string): Hex {
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`not an ISO currency code: ${code}`);
  return `0x${Buffer.from(code, "ascii").toString("hex")}` as Hex;
}

export function currencyFromBytes3(raw: Hex): string {
  return Buffer.from(raw.slice(2), "hex").toString("ascii").replace(/\0+$/, "");
}
