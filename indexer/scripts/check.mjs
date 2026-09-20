/**
 * Validates the indexer without the Envio CLI, which has no Windows build.
 *
 * Two failures are worth catching here because neither one errors at runtime — they just quietly
 * index nothing: an event signature that drifts from the deployed ABI, and a contract declared
 * without an address on the chain it is supposed to be read from.
 *
 *   npm run check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { parseAbiItem, toEventSelector } from "viem";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = YAML.parse(fs.readFileSync(path.join(root, "config.yaml"), "utf8"));

const problems = [];
const signatureOf = (entry) =>
  `event ${entry.name}(${entry.inputs
    .map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`)
    .join(", ")})`;

for (const contract of config.contracts) {
  const abiPath = path.join(root, "abis", `${contract.name}.json`);
  if (!fs.existsSync(abiPath)) {
    problems.push(`${contract.name}: no ABI at abis/${contract.name}.json`);
    continue;
  }
  const abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));
  const onChain = new Map(
    abi
      .filter((entry) => entry.type === "event")
      .map((entry) => [entry.name, toEventSelector(parseAbiItem(signatureOf(entry)))]),
  );

  for (const { event } of contract.events) {
    const name = event.slice(0, event.indexOf("("));
    let topic;
    try {
      topic = toEventSelector(parseAbiItem(`event ${event}`));
    } catch (error) {
      problems.push(`${contract.name}.${name}: unparseable — ${String(error).split("\n")[0]}`);
      continue;
    }
    if (!onChain.has(name)) problems.push(`${contract.name}.${name}: not in the deployed ABI`);
    else if (onChain.get(name) !== topic) {
      problems.push(`${contract.name}.${name}: signature does not match the deployed ABI`);
    }
  }
}

for (const chain of config.chains) {
  const declared = new Set(config.contracts.map((c) => c.name));
  const addressed = new Set(chain.contracts.map((c) => c.name));
  for (const name of declared) {
    if (!addressed.has(name)) problems.push(`chain ${chain.id}: ${name} has no address`);
  }
  for (const entry of chain.contracts) {
    if (!declared.has(entry.name)) problems.push(`chain ${chain.id}: ${entry.name} is not declared`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(entry.address)) {
      problems.push(`chain ${chain.id}: ${entry.name} has a malformed address`);
    }
  }
}

const events = config.contracts.reduce((n, c) => n + c.events.length, 0);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`ok — ${events} event signatures match the deployed ABIs, every contract has an address`);
