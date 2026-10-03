# Hosting the relayer

The relayer is a long-lived process with an encrypted vault on disk, so it needs a host that keeps
both. Vercel cannot run it: serverless functions have no persistent filesystem, and the vault holds
recipients' bank details.

Nothing in here is required for the chain to work. `finalize`, `refund` and `claim` are
permissionless, so if this service is down, orders still settle and senders still get refunded. What
stops without it is new orders, quotes, and the links the chat hands out.

## What it needs

| Variable | Why | Secret |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | Signs and pays for submissions. Holds MON for gas and nothing else. | **yes** |
| `RECIPIENT_ENCRYPTION_KEY` | 32 bytes of hex. Encrypts bank details at rest. | **yes** |
| `BOT_API_KEY` | Shared secret for the bot-only endpoints. Must match the bot's. | **yes** |
| `PAYSTACK_SECRET_KEY` | Resolves account names so a sender sees who they are paying. | **yes** |
| `RPC_URL` | Monad testnet endpoint. | no |
| `RAIL_CORE` | The escrow. | no |
| `AUSD_ADDRESS` | The settlement asset. | no |
| `RAIL_ATTESTOR` | Default attestor for orders. | no |
| `APP_BASE_URL` | Where the links the bot hands out should point. | no |
| `ALLOWED_ORIGINS` | Origins the browser app may call from. Defaults to `APP_BASE_URL`. | no |
| `FX_URL` | Live rate source. Has a default. | no |

**Losing `RECIPIENT_ENCRYPTION_KEY` makes every stored recipient unreadable.** It is not derivable
and not recoverable. Keep a copy somewhere that is not this machine.

## A volume is not optional

Mount one at **`/data`**. The image sets `VAULT_DIR=/data/vault` and `RECIPIENT_DIR=/data/recipients`.

Without it the container still starts and still works, and then every saved recipient and every
pending link disappears on the next deploy, silently. That failure is invisible until a sender tries
to send to someone they added yesterday.

## Deploying on Railway

The browser login flow issues a device code that expires in about two minutes, which is awkward to
coordinate. A project token has no such limit:

1. Railway dashboard, project, **Settings → Tokens**, create one.
2. Put it in a gitignored file, never in a commit:

   ```bash
   echo "RAILWAY_TOKEN=<the token>" >> services/.env.railway.local
   ```

3. From `services/`:

   ```bash
   npx @railway/cli up --detach
   ```

Then add a volume at `/data` and set the variables above in the dashboard. The health check at
`/healthz` tells the platform whether the process is actually serving.

## After it is up

Point the app at it, so the links in chat reach a relayer that exists:

```bash
cd web
npx vercel env add NEXT_PUBLIC_RELAYER_URL production   # https://<your-service>.up.railway.app
npx vercel --prod
```

And set `ALLOWED_ORIGINS` on the relayer to the app's origin, or the browser will refuse every call
with a CORS error that looks like a connection failure.
