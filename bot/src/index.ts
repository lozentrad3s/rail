/**
 * rail-bot — the WhatsApp front door.
 *
 * It proposes payments and hands back links. It holds no key, keeps no session, and has no path
 * to `POST /v1/orders`: everything that moves money is authorised by a passkey in the app
 * (invariant 2). Take this whole process over and you can send people links, nothing more.
 */
import { createServer, type IncomingMessage } from "node:http";

import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

import { loadConfig } from "./config.ts";
import { replyTo } from "./handle.ts";
import { RelayerClient } from "./relayer.ts";
import { verifyChallenge, verifySignature } from "./signature.ts";
import { readMessages, WhatsAppClient } from "./whatsapp.ts";

const config = loadConfig();
const log = (line: string): void => console.log(line);

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 2, retryDelay: 200 }),
});

const deps = {
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

const whatsapp = new WhatsAppClient(config);

/** The signature is over the exact bytes received, so the body is never parsed before the check. */
function rawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // A webhook is small. Anything larger is not Meta.
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * Meta retries a webhook it does not see acknowledged within seconds, and a retry would reply
 * twice. So the delivery is acknowledged first and the work happens after.
 */
const seen = new Set<string>();

async function handleDelivery(payload: unknown): Promise<void> {
  for (const message of readMessages(payload)) {
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    // Bounded, because this process is long-lived and a Set is not a cache.
    if (seen.size > 10_000) seen.clear();

    try {
      const reply = await replyTo(deps, message.waId, message.text);
      await whatsapp.sendText(message.waId, reply);
    } catch (cause) {
      // The message text is never logged: it is somebody's conversation.
      log(`${new Date().toISOString()} delivery-failed id=${message.messageId} detail=${String(cause)}`);
    }
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://bot.local");

    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }

    if (request.method === "GET" && url.pathname === "/webhook") {
      const challenge = verifyChallenge(url.searchParams, config.verifyToken);
      if (challenge === undefined) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end(challenge);
      return;
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      let body: Buffer;
      try {
        body = await rawBody(request);
      } catch {
        response.writeHead(413).end();
        return;
      }

      const header = request.headers["x-hub-signature-256"];
      if (!verifySignature(body, typeof header === "string" ? header : undefined, config.appSecret)) {
        log(`${new Date().toISOString()} webhook-rejected reason=signature`);
        response.writeHead(401).end();
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        response.writeHead(400).end();
        return;
      }

      // Acknowledged before the work, so Meta does not retry and double-reply.
      response.writeHead(200).end();
      await handleDelivery(payload);
      return;
    }

    response.writeHead(404).end();
  })();
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
