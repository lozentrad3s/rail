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
| `INDEXER_URL` | Envio GraphQL endpoint. Lets the sweeper find live orders it did not submit itself. Optional | no |
| `SWEEP_INTERVAL_MS` | How often expired orders are refunded or finalized. Default 20000 | no |

**Losing `RECIPIENT_ENCRYPTION_KEY` makes every stored recipient unreadable.** It is not derivable
and not recoverable. Keep a copy somewhere that is not this machine.

## A volume is not optional

Mount one at **`/data`**. The image sets `VAULT_DIR=/data/vault` and `RECIPIENT_DIR=/data/recipients`.

Without it the container still starts and still works, and then every saved recipient and every
pending link disappears on the next deploy, silently. That failure is invisible until a sender tries
to send to someone they added yesterday.

**Never set `VAULT_DIR` or `RECIPIENT_DIR` from Git Bash.** It rewrites `/data/vault` into
`C:/Program Files/Git/data/vault`, which on Linux is a directory inside the container and off the
volume. That is exactly what Railway held until 9 Oct 2026. The Dockerfile already sets both, so the
right move is to not set them at all; the relayer now also recovers the mangled form and logs it.

## Deploying on Railway

The browser login flow issues a device code that expires in about two minutes, which is awkward to
coordinate. A project token has no such limit:

1. Railway dashboard, project, **Settings → Tokens**, create one.
2. Put it in a gitignored file, never in a commit:

   ```bash
   echo "RAILWAY_TOKEN=<the token>" >> services/.env.railway.local
   ```

3. From the repo root, deploying `services/` as the build root:

   ```bash
   railway up services --path-as-root --detach
   ```

   The repo root is linked to the **Rail-pay** project and its relayer service. A bare `railway up`
   uploads the whole repo, which has no single app to build, and fails.

Then add a volume at `/data` and set the variables above in the dashboard, **plus
`RAILWAY_RUN_UID=0`**. Railway mounts the volume owned by root and the image runs as `node`, so
without it the relayer cannot write to `/data` and exits with `EACCES`. The health check at
`/healthz` tells the platform whether the process is actually serving.

## After it is up

Point the app at it, so the links in chat reach a relayer that exists:

```bash
cd web
npx vercel env add NEXT_PUBLIC_RELAYER_URL production   # https://<your-service>.up.railway.app
```

Then push to `main`. The Vercel project's Root Directory is `web`, so a push builds the app; an env
change takes effect on the next build. Do not run `vercel --prod` from inside `web/` any more: with
the Root Directory set, the CLI looks for `web/web` and the build fails.

And set `ALLOWED_ORIGINS` on the relayer to the app's origin, or the browser will refuse every call
with a CORS error that looks like a connection failure.

## The provider bots

The same image runs the reference provider (`rail-matcher`). Railway starts whatever
`SERVICE_ENTRY` names, so a provider service sets `SERVICE_ENTRY=../matcher/src/index.ts` and the
relayer leaves it unset. Each provider is its own service with its own key:

| Variable | Value |
|---|---|
| `SERVICE_ENTRY` | `../matcher/src/index.ts` |
| `LP_PRIVATE_KEY` | **secret** — a testnet LP key that is already staked |
| `RPC_URL`, `RAIL_CORE`, `LP_REGISTRY` | as in docs/DEPLOYMENTS.md |
| `RATE`, `SPREAD_BPS` | its own cost of naira and its margin; must sit inside the 2% reserve buffer |
| `MAX_ORDER_AUSD` | under its free stake divided by 1.1, or a winning reveal cannot lock collateral |
| `AUTO_CONFIRM_PAYOUT` | `true` on the testnet pilot: the payout is **simulated** and served at `/simulated-bank/credits` for the CRE attestor. Refused on any other chain |
| `STATE_DIR` | `/data/matcher`, on a volume, so a restart mid-auction can still reveal |
| `RAILWAY_RUN_UID` | `0`, for the same volume-ownership reason as the relayer |
