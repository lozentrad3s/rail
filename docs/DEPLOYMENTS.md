# Rail — Deployments

Addresses, parameters, and what has actually been proven against them.

---

## Monad testnet (chain `10143`)

Deployed 20 September 2026 from `0x3dD62d5021cA5cA5439f87Be8772A21b9b662C2c`.

| Contract | Address |
|---|---|
| `RailCore` | [`0xf0A34887d703300FA73533678A4a1f9D3B68c27F`](https://testnet.monadexplorer.com/address/0xf0A34887d703300FA73533678A4a1f9D3B68c27F) |
| `LPRegistry` | [`0xbcbB919329A3f86ddC6A3c948788201c2fD48b5a`](https://testnet.monadexplorer.com/address/0xbcbB919329A3f86ddC6A3c948788201c2fD48b5a) |
| `SignedAttestor` (minLayer 1) | [`0x2D6637D0F9C89648B39eF5f776E9923734C8CFdA`](https://testnet.monadexplorer.com/address/0x2D6637D0F9C89648B39eF5f776E9923734C8CFdA) |
| AUSD (Agora, not ours) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadexplorer.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |
| AUSD faucet (Agora, not ours) | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` — `requestFunds(address)`, 10,000 AUSD per call, once a minute, 100,000 held per address |

### Parameters

| Parameter | Value | At 300ms blocks |
|---|---|---|
| `commitBlocks` | 5 | ~1.5s |
| `revealBlocks` | 5 | ~1.5s |
| `payoutBlocks` | 2000 | ~10 min |
| `disputeBlocks` | 200 | ~60s |
| `resolutionBlocks` | 2000 | ~10 min |
| `collateralBps` | 11000 | 110% of the winning bid |
| `minStake` | 100 AUSD | |
| `unstakeCooldown` | 86400 s | 24h, wall-clock |

`disputeBlocks` at 200 is a demo value. **It is the only thing between a lying provider and the
escrow when no attestor has spoken** — production is hours.

The owner (`RAIL_OWNER`, currently the deployer) can pause the creation of new orders and nothing
else. Settlement, refunds and claims are permissionless whoever holds it.

### What has been proven on this deployment

Order [`0x1633028fba24ed3669ec3410c2f01edb58c779e1af7459c4b59f5353f2745421`](https://testnet.monadexplorer.com/tx/0xd0d40f2eba38c9a74657ccf2c7a13177fa90ba5d9101fd577bd7d455cc746182),
20 September 2026:

1. A sender holding **zero MON** authorised $33.60 with one EIP-3009 signature, and the **live AUSD
   contract** — not a mock — accepted it with the order id bound in as the nonce.
2. The relayer paid the fee and submitted it. Escrow landed: sender $50.00 → $16.27, core $33.60.
3. Nobody bid, so after the reveal window a **stranger** called `refund`. The order cancelled and
   the sender got $33.60 back — $49.87 of the original $50.00, the $0.13 relayer fee being the only
   cost. The core's balance returned to zero.

Still to prove on **this** instance: a payout attested at layer 1, and a default that slashes
collateral to the sender.

## Monad testnet — pilot instance (chain `10143`)

Deployed 20 September 2026. Same code, different windows.

| Contract | Address |
|---|---|
| `RailCore` | [`0x90026A694D392888dd8feEbC63ccA729A037a2D0`](https://testnet.monadexplorer.com/address/0x90026A694D392888dd8feEbC63ccA729A037a2D0) |
| `LPRegistry` | [`0x5Ea55eCaa06Fa530CfDB065bAeEEb05CC5cF0344`](https://testnet.monadexplorer.com/address/0x5Ea55eCaa06Fa530CfDB065bAeEEb05CC5cF0344) |
| `SignedAttestor` (minLayer 1) | [`0x0ECc0916113D70875B7BEE2F27AF64cCfe57a90e`](https://testnet.monadexplorer.com/address/0x0ECc0916113D70875B7BEE2F27AF64cCfe57a90e) |

`commitBlocks` and `revealBlocks` are **15**, not 5. Everything else is unchanged.

### Why 15 and not 5

Five blocks is the floor Monad's block time allows, and the first deployment used it. Measured
against the public RPC from a laptop, a provider bot needs about six blocks between an order
appearing and its commit being **mined** — the event has to arrive, the transaction has to be
signed and broadcast, and it has to be included. The evidence, from live runs:

| Attempt | Result |
|---|---|
| Polling, gas estimated per call | both bids reverted, 1 and 4 blocks late |
| WebSocket, cached nonce and fees, pushed head | one bid landed with **0 blocks to spare**, the other 1 block late |
| Same bots, 15-block window | **both landed with 9 blocks to spare** |

A window only the luckiest bidder can reach is the opposite of what an auction is for: it produces
one bid, not competition, and the sender pays more. Fifteen blocks lets providers on ordinary
connections compete, and the whole auction still finishes in about twelve seconds.

The protocol did not change. These are constructor parameters, and a deployment for providers who
run their own nodes could still use five.

### The contested auction

Order [`0x22674ed69e03311fdd28b339cb5031f28f3098577ccb751111d7a586cb47ef2d`](https://testnet.monadexplorer.com/tx/0x22674ed69e03311fdd28b339cb5031f28f3098577ccb751111d7a586cb47ef2d),
two independent `rail-matcher` instances bidding against each other:

| Provider | Margin | Sealed bid | Outcome |
|---|---|---|---|
| `0x0F63…7fC6` | 1.5% | **$33.083442** | **won** |
| `0x57CB…ce04` | 3.0% | $33.572360 | lost, collateral released |

Both committed in the same block, both revealed, the lower bid won. On settlement:

```
winner paid            33,083,442 units   exactly its bid
sender change returned    516,558 units   the saving from competition
core balance                      0       the protocol kept nothing
```

33,083,442 + 516,558 = 33,600,000, the reserve price the sender signed. **The sender captured every
cent of the saving**, which is invariant 5 holding on a live chain rather than in a test.

### Indexer

[Envio Cloud](https://envio.dev), indexer `rail`, development tier, built from `main` with root
directory `indexer`. Public GraphQL:

```
https://indexer.dev.hyperindex.xyz/c029a2e/v1/graphql
```

Synced from block 63549435. The free tier deletes deployments after 30 days and after 7 days of
inactivity, so this must be redeployed close enough to judging (14–27 Oct) to still be alive.

### Costs measured

| Action | Gas | Note |
|---|---|---|
| Deploying all three contracts | ~0.64 MON total | |
| `createOrder` | ~362,000 | |
| `refund` | ~94,000 | |
| AUSD faucet call | 156,720 charged against a 130,600 estimate | **Monad charges the declared gas limit, not gas used.** Always set an explicit limit with margin |

---

## Monad mainnet (chain `143`)

Not deployed. Mainnet AUSD is [`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`](https://monadscan.com/address/0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a).

---

## Reproducing

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
AUSD_ADDRESS=… RAIL_CORE=… RAIL_ATTESTOR=… \
  forge script script/CreateOrder.s.sol --rpc-url $RPC_URL --broadcast
```

Keys come from `.env.testnet` at the repo root, which is gitignored and holds testnet-only keys.
Never put real funds behind them.
