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

Still to prove here: a contested auction with two providers, a payout attested at layer 1, and a
default that slashes collateral to the sender. Those need the matcher bot, because a 5+5 block
auction is over in about three seconds — too fast to drive by hand.

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
