/**
 * The slice of Rail this bot touches.
 *
 * Written out rather than generated from an ABI file so the signatures a provider's money depends
 * on are readable here. They are checked against the deployed contract at startup.
 */
import { parseAbi, type Hex } from "viem";

export const railCoreAbi = parseAbi([
  "struct Order { address sender; uint8 status; bytes3 currency; uint64 commitEnd; address winner; uint64 revealEnd; address attestor; uint64 payoutDeadline; uint128 maxAusd; uint128 winningBid; bytes32 recipientCommitment; uint256 localAmount; uint64 disputeEnd; uint64 resolutionEnd; }",
  "event OrderCreated(bytes32 indexed orderId, address indexed sender, bytes3 indexed currency, uint256 localAmount, uint256 maxAusd, uint256 fee, address attestor, bytes32 recipientCommitment, uint64 commitEnd, uint64 revealEnd)",
  "function commitBid(bytes32 orderId, bytes32 commitment)",
  "function revealBid(bytes32 orderId, uint256 amount, bytes32 salt)",
  "function closeAuction(bytes32 orderId)",
  "function markPaid(bytes32 orderId)",
  "function getOrder(bytes32 orderId) view returns (Order)",
  "function computeCommitment(bytes32 orderId, address lp, uint256 amount, bytes32 salt) pure returns (bytes32)",
  "function collateralFor(uint256 bid) view returns (uint256)",
]);

export const lpRegistryAbi = parseAbi([
  "function isEligible(address lp) view returns (bool)",
  "function freeStake(address lp) view returns (uint256)",
  "function stake(uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** `Status` in the contract. Only the values this bot reasons about are named. */
export const Status = { None: 0, Open: 1, Awarded: 2, Paid: 3, Disputed: 4, Settled: 5, Refunded: 6, Cancelled: 7 } as const;

const STATUS_NAMES = [
  "None", "Open", "Awarded", "Paid", "Disputed", "Settled", "Refunded", "Cancelled",
] as const;

export function statusName(value: number): string {
  return STATUS_NAMES[value] ?? "Unknown";
}

/** ISO code from the on-chain `bytes3`, e.g. `NGN`. */
export function currencyCode(raw: Hex): string {
  const bytes = raw.replace(/^0x/, "").replace(/(00)+$/, "");
  let code = "";
  for (let i = 0; i < bytes.length; i += 2) code += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
  return code;
}
