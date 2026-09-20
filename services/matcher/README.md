# rail-matcher

The reference liquidity provider bot. It watches for orders, prices them, bids in the sealed
auction, and when it wins, pays the recipient and says so on-chain.

**Run two with different spreads and the cheaper one wins.** That is the whole argument for the
protocol, and it is the demo.

## What it does and does not touch

It holds one key. That key can stake collateral and bid. It can never touch a sender's escrowed
money — only `RailCore` can move that, and only along the paths in
[`docs/INTERFACES.md`](../../docs/INTERFACES.md) §2.

## Running it

```bash
cp .env.example .env     # fill in LP_PRIVATE_KEY
npm start
```

The account must already be staked in `LPRegistry`, or the bot refuses to start rather than
discovering it mid-auction.

## Two checks before it risks anything

1. **The commitment scheme is verified against the deployed contract.** A sealed bid is
   `keccak(orderId, lp, amount, salt)`. If our encoding ever drifted from the contract's, every
   commit would be unrevealable and the collateral would sit locked until the auction closed. It is
   cheap to check once at startup and expensive to discover live.
2. **Eligibility is read from the registry**, so a provider learns it has not staked before an
   auction rather than during one.

## The loop

```
OrderCreated
  → skip unless the currency, size and attestor are ones this provider accepts
  → price it; skip if our price is above the sender's reserve
  → persist (orderId, amount, salt) to disk        ← before the commit, never after
  → commitBid
  → wait past commitEnd → revealBid
  → wait past revealEnd → did we win?
      → no:  collateral released, nothing owed
      → yes: closeAuction if still open, pay the recipient, markPaid
```

**The salt is written to disk before the commit is sent.** Lose it and the bid can never be
revealed: the collateral stays locked until the auction closes and the provider simply loses. That
ordering is not an optimisation, it is the difference between a crash costing nothing and costing
money.

## Timing

The commit window is five blocks — about a second and a half on Monad. The bot polls every 250ms by
default and reacts immediately. If a provider's connection is too slow to make that window, it will
miss auctions rather than lose money; nothing is at risk from being late.

## Paying the recipient

`AUTO_CONFIRM_PAYOUT` is off by default, so on winning the bot logs what to pay and waits. **Marking
an order paid tells the chain money left your bank.** Doing that before it has is how a provider
gets its own collateral slashed. The flag exists for testnet runs where no real money moves.

## Tests

```bash
npm test          # 12 tests, no chain needed
npm run typecheck
```

The one that matters most asserts our commitment encoding matches `abi.encode` exactly — the same
thing checked against the live contract at startup.
