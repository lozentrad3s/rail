/**
 * rail-bot — the WhatsApp front door.
 *
 * It proposes payments and hands back links. It holds no key, keeps no session, and has no path
 * to `POST /v1/orders`: everything that moves money is authorised by a passkey in the app
 * (invariant 2). Take this whole process over and you can send people links, nothing more.
 *
 * This file is only wiring. The webhook lives in `./server.ts` so it can be attacked in tests.
 */
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

import { loadConfig } from "./config.ts";
import { RelayerClient } from "./relayer.ts";
import { createBotServer } from "./server.ts";
import { WhatsAppClient } from "./whatsapp.ts";

const config = loadConfig();
const log = (line: string): void => console.log(line);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2, retryDelay: 200 }),
});

const { server } = createBotServer({
  deps: {
    relayer: new RelayerClient(config.relayerBaseUrl, config.relayerApiKey),
    readBalance: (address: Address): Promise<bigint> =>
      publicClient.readContract({
        address: config.ausd,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    currency: config.currency,
    log,
  },
  whatsapp: new WhatsAppClient(config),
  verifyToken: config.verifyToken,
  appSecret: config.appSecret,
  log,
});

server.listen(config.port, () => {
  log(`${new Date().toISOString()} bot listening port=${config.port} relayer=${config.relayerBaseUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${new Date().toISOString()} stopping`);
    server.close(() => process.exit(0));
  });
}
