/**
 * relay — carries the CRE payout-attestor's verdict to Monad.
 *
 * The workflow decides whether a payout happened; it does not write anywhere. CRE has no forwarder
 * on Monad, and deploying a workflow needs Early Access this account does not have yet, so the
 * verdict comes from `cre workflow simulate` — the real workflow, compiled to WASM, run by the CRE
 * simulator — and this script relays it:
 *
 *   order Paid on-chain → run the workflow against the winner's bank feed → verdict
 *   → if and only if `attested: true`: sign a layer-3 Attestation → SignedAttestor.attest
 *   → RailCore.finalize, before the dispute window would have released it
 *
 * What that trusts, said plainly: the relay key (CRE_BRIDGE_PRIVATE_KEY, layer 3 on SignedAttestor)
 * signs what the simulator returned. Once the workflow is deployed with a Monad forwarder, the DON's
 * report writes directly and this key goes away. Either way invariant 8 holds: an attestation can
 * only make settlement sooner, and if this script never runs the order settles on its own.
 *
 * On the pilot the bank feed is each provider's **simulated** bank (services/matcher/src/bank.ts).
 *
 *   bun relay.ts 0x<orderId>        relay one order
 *   bun relay.ts --watch            relay every Paid order that names SignedAttestor, as it appears
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const RAIL_CORE = (process.env.RAIL_CORE ?? "0xfa8C88Ee0fCF869783F489cADB222750F576f221") as Address;
const ATTESTOR = (process.env.RAIL_ATTESTOR ?? "0x507756b1f5CCC8d1C960468ca815DA2efFDD3906") as Address;
const RPC = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const INDEXER = process.env.INDEXER_URL ?? "https://indexer.dev.hyperindex.xyz/8e31d9a/v1/graphql";

/** Which bank feed proves which provider's payout. On the pilot, each bot's simulated bank. */
const FEEDS: Record<string, string> = Object.fromEntries(
  (
    process.env.PROVIDER_FEEDS ??
    "0x0F631063f4c6e3cAD34F124155d1942c90Cd7fC6=https://rail-provider-a-production.up.railway.app," +
      "0x57CBd204E79384B9D51454129B78Aa1782Ffce04=https://rail-provider-b-production.up.railway.app"
  )
    .split(",")
    .map((pair) => pair.split("=") as [string, string])
    .map(([lp, url]) => [lp.trim().toLowerCase(), `${url.trim().replace(/\/+$/, "")}/simulated-bank/credits`]),
);

const coreAbi = parseAbi([
  "struct Order { address sender; uint8 status; bytes3 currency; uint64 commitEnd; address winner; uint64 revealEnd; address attestor; uint64 payoutDeadline; uint128 maxAusd; uint128 winningBid; bytes32 recipientCommitment; uint256 localAmount; uint64 disputeEnd; uint64 resolutionEnd; }",
  "function getOrder(bytes32 orderId) view returns (Order)",
  "function canFinalize(bytes32 orderId) view returns (bool)",
  "function finalize(bytes32 orderId)",
]);
const attestorAbi = parseAbi([
  "function attest(bytes32 orderId, bytes32 evidenceHash, bytes signature)",
  "function recordOf(bytes32 orderId) view returns (uint8 layer, bytes32 evidenceHash, address signer)",
]);

const relayKey = process.env.CRE_BRIDGE_PRIVATE_KEY as Hex | undefined;
const gasKey = (process.env.RELAY_GAS_PRIVATE_KEY ?? process.env.TESTNET_DEPLOYER_PRIVATE_KEY) as Hex | undefined;
if (!relayKey || !gasKey) {
  console.error("Set CRE_BRIDGE_PRIVATE_KEY (signs) and RELAY_GAS_PRIVATE_KEY or TESTNET_DEPLOYER_PRIVATE_KEY (pays gas).");
  process.exit(1);
}
const relay = privateKeyToAccount(relayKey);
const transport = http(RPC, { timeout: 15_000, retryCount: 2 });
const chain = createPublicClient({ chain: monadTestnet, transport });
const payer = createWalletClient({ chain: monadTestnet, transport, account: privateKeyToAccount(gasKey) });

const here = dirname(fileURLToPath(import.meta.url));
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const narrationFor = (orderId: Hex) => `RAIL${orderId.slice(2, 10).toUpperCase()}`;
const currencyOf = (raw: Hex) => Buffer.from(raw.slice(2), "hex").toString("ascii").replace(/\0+$/, "");

/**
 * Compiled once, up front. Compiling inside every simulation cost ~40 of its ~55 seconds, which on
 * the first live order put the attestation two blocks *after* the 200-block dispute window — so the
 * DON's verdict arrived, but too late to be the thing that settled it.
 */
let wasm: string | undefined;
function buildOnce(): string {
  if (wasm) return wasm;
  const out = join(mkdtempSync(join(tmpdir(), "cre-wasm-")), "payout-attestor.wasm");
  say("compiling the workflow to WASM once");
  const build = spawnSync(
    "cre",
    ["workflow", "build", "payout-attestor", "--target", "staging-settings", "--output", out],
    { cwd: join(here, ".."), encoding: "utf8", shell: process.platform === "win32", timeout: 240_000 },
  );
  if (build.status !== 0) throw new Error(`cre workflow build failed: ${build.stdout}${build.stderr}`);
  wasm = out;
  return out;
}

/** Runs the real workflow in the CRE simulator and returns its parsed result. */
function runWorkflow(payload: object, bankApiUrl: string): { attested: boolean; bankReference: string | null; raw: string } {
  const dir = mkdtempSync(join(tmpdir(), "cre-relay-"));
  const payloadFile = join(dir, "payload.json");
  const configFile = join(dir, "config.json");
  writeFileSync(payloadFile, JSON.stringify(payload));
  writeFileSync(configFile, JSON.stringify({ bankApiUrl, authorizedKeys: [] }));

  const run = spawnSync(
    "cre",
    [
      "workflow", "simulate", "payout-attestor",
      "--target", "staging-settings",
      "--non-interactive",
      "--trigger-index", "0",
      "--http-payload", payloadFile,
      "--config", configFile,
      "--wasm", buildOnce(),
    ],
    { cwd: join(here, ".."), encoding: "utf8", shell: process.platform === "win32", timeout: 240_000 },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  for (const line of output.split(/\r?\n/)) if (/USER LOG|Simulation Result|verdict/.test(line)) say(`  cre | ${line.trim()}`);

  const lines = output.split(/\r?\n/);
  const at = lines.findIndex((line) => line.includes("Workflow Simulation Result"));
  if (at < 0 || !lines[at + 1]) throw new Error(`the workflow did not return a result:\n${output.slice(-1500)}`);
  // The simulator prints the handler's return value as a JSON-encoded string.
  const raw = JSON.parse(lines[at + 1]!.trim()) as string;
  const result = JSON.parse(raw) as { attested: boolean; bankReference: string | null };
  return { ...result, raw };
}

async function relayOrder(orderId: Hex): Promise<void> {
  const order = await chain.readContract({ address: RAIL_CORE, abi: coreAbi, functionName: "getOrder", args: [orderId] });
  if (order.attestor.toLowerCase() !== ATTESTOR.toLowerCase()) return say(`skip ${orderId}: names attestor ${order.attestor}`);
  if (order.status < 2 || order.status > 4) return say(`skip ${orderId}: status ${order.status} is not Awarded/Paid/Disputed`);

  const [layer] = await chain.readContract({ address: ATTESTOR, abi: attestorAbi, functionName: "recordOf", args: [orderId] });
  if (layer >= 3) return say(`skip ${orderId}: already attested at layer ${layer}`);

  const feed = FEEDS[order.winner.toLowerCase()];
  if (!feed) return say(`skip ${orderId}: no bank feed configured for provider ${order.winner}`);

  const payload = {
    orderId,
    narration: narrationFor(orderId),
    currency: currencyOf(order.currency),
    expectedMinor: order.localAmount.toString(),
  };
  say(`order ${orderId} paid by ${order.winner}; asking the CRE workflow whether ${payload.narration} landed (feed: ${feed}, SIMULATED bank)`);

  const verdict = runWorkflow(payload, feed);
  if (!verdict.attested) return say(`not attested: the DON did not find the payout. Nothing written; the dispute window still applies.`);

  // The evidence is the workflow's own output; only its hash goes on-chain (invariant 3).
  const evidenceHash = keccak256(toBytes(verdict.raw));
  const signature = await relay.signTypedData({
    domain: { name: "RailSignedAttestor", version: "1", chainId: monadTestnet.id, verifyingContract: ATTESTOR },
    types: { Attestation: [{ name: "orderId", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" }] },
    primaryType: "Attestation",
    message: { orderId, evidenceHash },
  });

  const send = async (address: Address, abi: typeof coreAbi | typeof attestorAbi, functionName: string, args: unknown[]) => {
    const request = { address, abi, functionName, args, account: payer.account } as Parameters<typeof chain.estimateContractGas>[0];
    const gas = await chain.estimateContractGas(request);
    // Monad charges the declared limit: estimate plus a fixed margin, never the node default.
    const hash = await payer.writeContract({ ...(request as object), gas: gas + 40_000n, chain: monadTestnet } as Parameters<typeof payer.writeContract>[0]);
    const receipt = await chain.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
    return receipt;
  };

  const attested = await send(ATTESTOR, attestorAbi, "attest", [orderId, evidenceHash, signature]);
  say(`attested at layer 3 in block ${attested.blockNumber} (dispute window ran to ${order.disputeEnd || "—"}) tx ${attested.transactionHash}`);

  if (await chain.readContract({ address: RAIL_CORE, abi: coreAbi, functionName: "canFinalize", args: [orderId] })) {
    const settled = await send(RAIL_CORE, coreAbi, "finalize", [orderId]);
    say(`finalized in block ${settled.blockNumber}: provider paid its bid, the rest back to the sender. tx ${settled.transactionHash}`);
  }
}

async function watch(): Promise<void> {
  say(`watching for Paid orders that name ${ATTESTOR}`);
  const done = new Set<string>();
  for (;;) {
    try {
      const response = await fetch(INDEXER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query($a: String!) { Order(where: { status: { _eq: "Paid" }, attestor: { _ilike: $a } }, limit: 20) { id } }`,
          variables: { a: ATTESTOR },
        }),
      });
      const body = (await response.json()) as { data?: { Order?: { id: Hex }[] } };
      for (const { id } of body.data?.Order ?? []) {
        if (done.has(id)) continue;
        done.add(id);
        await relayOrder(id).catch((error: unknown) => say(`relay failed for ${id}: ${error instanceof Error ? error.message : String(error)}`));
      }
    } catch (error) {
      say(`indexer unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

const arg = process.argv[2];
if (arg === "--watch") {
  buildOnce();
  await watch();
}
else if (arg && /^0x[0-9a-fA-F]{64}$/.test(arg)) await relayOrder(arg as Hex);
else {
  console.error("usage: bun relay.ts <orderId> | --watch");
  process.exit(1);
}
