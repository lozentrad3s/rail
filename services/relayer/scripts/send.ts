/**
 * One complete send, through the API, the way the app will do it.
 *
 * Quote, build the intent, sign a single EIP-3009 authorisation as the sender, hand it to the
 * relayer, and watch the auction. The sender holds no MON: the relayer pays the gas, and it cannot
 * alter a single field of what was signed.
 *
 *   node scripts/send.ts
 */
import {
  createPublicClient,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RELAYER = process.env.RELAYER_URL ?? "http://localhost:8787";
const RPC_URL = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const AUSD = (process.env.AUSD_ADDRESS ?? "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC") as Hex;
const RAIL_CORE = (process.env.RAIL_CORE ?? "0x1DdEa1bBA4978BF5C58889c9F1f9ef09e21236DE") as Hex;

const sender = privateKeyToAccount(process.env.TESTNET_SENDER_PRIVATE_KEY as Hex);
const client = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });

const dollars = (units: bigint | string): string => `$${formatUnits(BigInt(units), 6)}`;

async function api(path: string, init?: RequestInit): Promise<Record<string, string>> {
  const response = await fetch(`${RELAYER}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as Record<string, string> & { error?: { message: string } };
  if (!response.ok) throw new Error(`${path}: ${body.error?.message ?? response.status}`);
  return body;
}

/** A field the relayer must have sent. A script that quietly reads `undefined` is a script that lies. */
function must(body: Record<string, string | undefined>, field: string): string {
  const value = body[field];
  if (value === undefined) throw new Error(`the relayer did not return ${field}`);
  return value;
}

// 1. What will this cost?
const quote = await api("/v1/quote?currency=NGN&localAmount=5000000");
console.log(`quote     ₦50,000 → at most ${dollars(must(quote, "maxAusd"))} plus ${dollars(must(quote, "fee"))} fee`);

// 2. Where is it going? The bank details never reach the chain — only a salted hash does.
const recipient = {
  bankCode: "058",
  accountNumber: "0001234567",
  accountName: "ADAEZE O. OKONKWO",
  salt: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex,
};
const recipientCommitment = keccak256(
  encodeAbiParameters(parseAbiParameters("string, string, bytes32"), [
    recipient.bankCode,
    recipient.accountNumber,
    recipient.salt,
  ]),
);

const intent = {
  sender: sender.address,
  recipientCommitment,
  currency: quote.currencyBytes3 as Hex,
  localAmount: BigInt(must(quote, "localAmount")),
  maxAusd: BigInt(must(quote, "maxAusd")),
  fee: BigInt(must(quote, "fee")),
  relayer: quote.relayer as Hex,
  attestor: quote.attestor as Hex,
  salt: `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex,
};

// 3. The order id is the hash of everything above, and it doubles as the authorisation nonce.
//    That is what stops the relayer changing any of it.
const orderId = await client.readContract({
  address: RAIL_CORE,
  abi: parseAbi([
    "struct OrderIntent { address sender; bytes32 recipientCommitment; bytes3 currency; uint256 localAmount; uint256 maxAusd; uint256 fee; address relayer; address attestor; bytes32 salt; }",
    "function hashIntent(OrderIntent intent) view returns (bytes32)",
  ]),
  functionName: "hashIntent",
  args: [intent],
});

// 4. One signature from the sender. The token's domain is read from the token, never hardcoded.
const [, name, version] = await client.readContract({
  address: AUSD,
  abi: parseAbi([
    "function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])",
  ]),
  functionName: "eip712Domain",
});

const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
const signature = await sender.signTypedData({
  domain: { name, version, chainId: monadTestnet.id, verifyingContract: AUSD },
  types: {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "ReceiveWithAuthorization",
  message: {
    from: sender.address,
    to: RAIL_CORE,
    value: intent.maxAusd + intent.fee,
    validAfter,
    validBefore,
    nonce: orderId,
  },
});

console.log(`signed    one authorisation, sender holds ${await client.getBalance({ address: sender.address })} wei of MON`);

// 5. Hand it to the relayer.
const created = await api("/v1/orders", {
  method: "POST",
  body: JSON.stringify({
    intent: {
      ...intent,
      localAmount: intent.localAmount.toString(),
      maxAusd: intent.maxAusd.toString(),
      fee: intent.fee.toString(),
    },
    authorization: {
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      v: BigInt(`0x${signature.slice(130, 132)}`).toString(),
      r: signature.slice(0, 66),
      s: `0x${signature.slice(66, 130)}`,
    },
    recipient,
  }),
});
console.log(`submitted order ${created.orderId}`);

// 6. Watch the auction.
let last = "";
for (let i = 0; i < 40; i++) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const order = await api(`/v1/orders/${created.orderId}`);
  const line = `${order.status}${order.winner ? ` winner=${order.winner} bid=${dollars(must(order, "winningBid"))}` : ""}`;
  if (line !== last) {
    console.log(`status    ${line}`);
    last = line;
  }
  if (order.status === "Settled" || order.status === "Refunded" || order.status === "Cancelled") {
    if (order.change) console.log(`saving    ${dollars(order.change)} returned to the sender`);
    break;
  }
}
