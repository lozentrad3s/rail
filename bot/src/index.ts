/**
 * rail-bot — the chat front door.
 *
 * It proposes payments and hands back links. It holds no key, keeps no session, and has no path
 * to `POST /v1/orders`: everything that moves money is authorised by a passkey or a connected
 * wallet in the app (invariant 2). Take this whole process over and you can send people links,
 * nothing more. That is true on every transport, which is what makes adding one cheap.
 *
 * This file is only wiring. The conversation lives in `./handle.ts`, the WhatsApp webhook in
 * `./server.ts`, and Telegram in `./telegram.ts`.
 */
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

import { loadConfig } from "./config.ts";
import type { Deps } from "./handle.ts";
import { RelayerClient } from "./relayer.ts";
import { createBotServer } from "./server.ts";
import { pollForever, TelegramClient } from "./telegram.ts";
import { WhatsAppClient } from "./whatsapp.ts";

const config = loadConfig();
const log = (line: string): void => console.log(line);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2, retryDelay: 200 }),
});

const deps: Deps = {
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
};

let stopping = false;
const onSignal = (handler: () => void): void => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      log(`${new Date().toISOString()} stopping`);
      handler();
    });
  }
};

if (config.transport === "telegram") {
  const client = new TelegramClient({ token: config.botToken, apiBaseUrl: config.apiBaseUrl });

  // Fail loudly on a bad token rather than polling forever against a 401.
  const { username } = await client.whoAmI();

  if (config.mode === "polling") {
    // A webhook left over from an earlier run makes Telegram refuse to serve getUpdates.
    await client.dropWebhook();
    log(`${new Date().toISOString()} bot listening transport=telegram mode=polling as=@${username}`);

    onSignal(() => process.exit(0));
    await pollForever({ deps, client, log, running: () => !stopping });
  } else {
    // Webhook mode exists for when there is a public URL; polling needs none, which is why it is
    // the default. The handler is shared with WhatsApp — only the authentication differs.
    const { server } = createBotServer({
      deps,
      whatsapp: {
        sendText: (to, body) => client.sendText(Number(to.replace(/^tg:/, "")), body),
      },
      verifyToken: "",
      appSecret: "",
      log,
      telegram: { secret: config.webhookSecret ?? "" },
    });

    server.listen(config.port, () => {
      log(
        `${new Date().toISOString()} bot listening transport=telegram mode=webhook port=${config.port} as=@${username}`,
      );
    });
    onSignal(() => server.close(() => process.exit(0)));
  }
} else {
  const { server } = createBotServer({
    deps,
    whatsapp: new WhatsAppClient(config),
    verifyToken: config.verifyToken,
    appSecret: config.appSecret,
    log,
  });

  server.listen(config.port, () => {
    log(
      `${new Date().toISOString()} bot listening transport=whatsapp port=${config.port} relayer=${config.relayerBaseUrl}`,
    );
  });
  onSignal(() => server.close(() => process.exit(0)));
}
