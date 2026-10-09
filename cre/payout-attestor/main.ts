/**
 * payout-attestor entry point. The workflow itself is in workflow.ts.
 *
 * This file exports nothing but `main`, and calls it: javy compiles the entry module's exports into
 * WASM exports and rejects any that take parameters, which is why the logic lives elsewhere.
 */
import { Runner } from "@chainlink/cre-sdk";

import { initWorkflow, type Config } from "./workflow";

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
