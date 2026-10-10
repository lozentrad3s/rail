# rail-matcher — run your own bidding bot

The provider page at [rail-pay.vercel.app/provider](https://rail-pay.vercel.app/provider) lets you
bid by hand, or on autopilot while the page is open. This is the next step: a bot that bids for you
around the clock, with no page open and no wallet prompts.

It watches for transfer requests, prices each at your rate and margin, seals a bid, reveals it, and
tells you when you have won so you can pay. Two of these are running on the pilot right now, with
different margins, and the cheaper one wins every time — which is the whole argument for the auction.

## Why it needs its own key

A bid can only come from the key that staked: the contract checks that the caller is the provider.
That is what makes the collateral mean something, and it is why nothing — not the relayer, not the
chat bot, not Rail — can bid on your behalf. A bot that bids without asking you each time therefore
has to hold that key itself.

So give it **a key used only for this**, staked with only what you are willing to have on
autopilot. It can stake, bid, reveal and confirm payments for its own address. It can never touch a
sender's money: only `RailCore` moves escrow, along the paths in
[`docs/INTERFACES.md`](../../docs/INTERFACES.md) §2.

## Five steps

1. **Make a key and fund it.** Any new EVM account. Send it a little MON for network fees (each bid
   and reveal costs a fraction of a cent) and AUSD to stake. On the testnet, the provider page's
   "Get $10,000 test AUSD" button and [faucet.monad.xyz](https://faucet.monad.xyz) cover both.
2. **Stake.** Import the key into a browser wallet and use the provider page once, or run
   `contracts/script/Stake.s.sol`. The minimum is $100; a winning bid locks 110% of itself.
3. **Configure.** `cp .env.example .env` and set `LP_PRIVATE_KEY`, your `RATE` (your own cost of
   naira per dollar) and `SPREAD_BPS` (your margin; keep it under the senders' 2% buffer).
4. **Run.** `npm start` from this directory, on any machine that stays on. Or host it — below.
5. **Pay when you win.** The bot logs `won-awaiting-payout`. Open the provider page signed in with
   the same key: the win is under **Your wins** with the account to pay and the reference. Pay from
   your bank, tap **I have paid**.

## Hosting it on Railway

The services image runs either process; `SERVICE_ENTRY` picks this one.

```bash
railway add --service my-rail-bot \
  -v SERVICE_ENTRY=../matcher/src/index.ts \
  -v RPC_URL=https://testnet-rpc.monad.xyz \
  -v RAIL_CORE=0xfa8C88Ee0fCF869783F489cADB222750F576f221 \
  -v LP_REGISTRY=0x4C10f838b44A67C09B368c744D0d281cB3407E09 \
  -v RATE=1331 -v SPREAD_BPS=100 -v MAX_ORDER_AUSD=180000000 \
  -v STATE_DIR=/data/matcher -v RAILWAY_RUN_UID=0 \
  -v LP_PRIVATE_KEY=<your bot's key>
railway volume add --mount-path /data      # bid salts must survive a restart
railway up services --path-as-root --service my-rail-bot
```

From Git Bash, prefix with `MSYS_NO_PATHCONV=1` or it rewrites `/data/matcher` into a Windows path.
`GET /healthz` on the service's domain says whether it is watching the chain.

## Paying the recipient

`AUTO_CONFIRM_PAYOUT` is off by default: on winning, the bot waits for you. **Marking an order paid
tells the chain money left your bank.** Doing that before it has is how a provider gets its own
collateral slashed.

On the testnet pilot the two hosted bots set it on, which makes their payout **simulated**: each
records the transfer it would have made at `/simulated-bank/credits`, labelled as simulated, and the
CRE workflow checks that record exactly as it would a real bank feed. The bot refuses to start that
way on any chain but the testnet.

## Two checks before it risks anything

1. **The commitment scheme is verified against the deployed contract** at startup. If the encoding
   ever drifted, every commit would be unrevealable.
2. **Eligibility is read from the registry**, so you learn you have not staked before an auction,
   not during one.

## The loop

```
OrderCreated (pushed over a WebSocket, polling as the fallback)
  → skip unless the currency, size and attestor are ones you accept
  → price it; skip if your price is above the sender's ceiling
  → write (orderId, amount, salt) to disk          ← before the commit, never after
  → commitBid → wait past commitEnd → revealBid → wait past revealEnd
  → won?  no:  collateral released, nothing owed
          yes: pay the recipient, markPaid
```

**The salt is written to disk before the commit is sent.** Lose it and the bid can never be
revealed. That ordering is the difference between a crash costing nothing and costing money.

## Tests

```bash
npm test          # 16 tests, no chain needed
npm run typecheck
```
