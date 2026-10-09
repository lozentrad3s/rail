# Rail — Interfaces

**This is the contract between modules.** Implement from this file, not from a description of it.
If code and this file disagree, this file wins; if this file is wrong, change it first, in its own
commit, then the code. Governed by `CLAUDE.md`.

Status: **v2 · 18 Sep 2026 · adds sender passkey accounts (§5.5.1)**

---

## 1 · Conventions

| Thing | Convention |
|---|---|
| Chain | Monad testnet `10143` during build, mainnet `143` from R28 |
| Stablecoin | AUSD, **6 decimals**. Mainnet `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` · Testnet `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (testnet faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`). Both proxy to implementation `0xc1e3c7d486d6a92fbe920232e439eec2ceb112da`. EIP-712 domain `"Agora Dollar"` / `"1"`. Verified on-chain 16 Sep 2026 |
| Block time | ~300ms, ~600ms finality (monad.xyz). Block counts, not seconds, are the source of truth |
| AUSD amounts | `uint256` base units. In Rust/TS: `amount_ausd_units` / `amountAusdUnits` |
| Local amounts | Minor units of the local currency (kobo for NGN, pesewa for GHS). Name the unit: `local_amount_minor` |
| Currency codes | ISO 4217 as `bytes3` on-chain (`"NGN"` = `0x4e474e`) |
| Order id | `bytes32` — the EIP-712 hash of the `OrderIntent` (§3.2). Also the EIP-3009 `nonce` |
| Windows | Block numbers. All window ends are **inclusive**: "during commit" means `block.number <= commitEnd` |
| Time on HTTP | Unix seconds, integers |
| Addresses on HTTP | `0x`-prefixed lowercase hex. `bytes32` likewise |
| Big numbers on HTTP | Decimal **strings** (`"32600000"`), never JSON numbers |

---

## 2 · Order state machine

```
             createOrder
                 │
                 ▼
               OPEN ── commit (≤ commitEnd) ── reveal (commitEnd < b ≤ revealEnd)
                 │
      b > revealEnd, no leading bid          b > revealEnd, leading bid exists
                 │                                        │  (lazy: any call awards)
                 ▼                                        ▼
            CANCELLED                                  AWARDED
     (maxAusd → sender)                    ┌─────────────┼───────────────────────┐
                                  markPaid │ (winner,    │ attested              │ b > payoutDeadline
                                           │ b ≤ payout- │ ─────────► finalize   │ and not attested
                                           ▼ Deadline)   │                       ▼
                                         PAID ───────────┤                   refund ──► REFUNDED
                                           │             │                   (maxAusd + slashed
                        dispute (sender,   │             │                    collateral → sender)
                        b ≤ disputeEnd)    │             │                       ▲
                                           ▼             │                       │
                                       DISPUTED ─────────┤ attested              │ b > resolutionEnd
                                           │             ▼                       │ and not attested
                                           │         SETTLED ◄── finalize ── PAID, b > disputeEnd
                                           │   (bid → LP, maxAusd − bid → sender)
                                           └─────────────────────────────────────┘
```

| From | Call | Who | Condition | To |
|---|---|---|---|---|
| — | `createOrder` | anyone holding the sender's signature | valid authorization, order id unused, not paused | `Open` |
| `Open` | `commitBid` | eligible LP | `b ≤ commitEnd` | `Open` |
| `Open` | `revealBid` | committed LP | `commitEnd < b ≤ revealEnd` | `Open` |
| `Open` | `closeAuction` | **anyone** | `b > revealEnd`, leading bid | `Awarded` |
| `Open` | `closeAuction` / `refund` | **anyone** | `b > revealEnd`, no leading bid | `Cancelled` |
| `Awarded` | `markPaid` | winner | `b ≤ payoutDeadline` | `Paid` |
| `Paid` | `dispute` | sender (direct or signature) | `b ≤ disputeEnd` | `Disputed` |
| `Awarded`/`Paid`/`Disputed` | `finalize` | **anyone** | attestor says delivered | `Settled` |
| `Paid` | `finalize` | **anyone** | `b > disputeEnd` (L0 optimistic) | `Settled` |
| `Awarded` | `refund` | **anyone** | `b > payoutDeadline` **and not attested** | `Refunded` |
| `Disputed` | `refund` | **anyone** | `b > resolutionEnd` **and not attested** | `Refunded` |

`markPaid`, `dispute`, `finalize` and `refund` all award lazily: if the order is `Open` past
`revealEnd` with a leading bid, they first transition it to `Awarded` (emitting `OrderAwarded`).

**Evidence dominates.** A positive attestation settles an order from `Awarded`, `Paid` or `Disputed`
at any time — including after `payoutDeadline` or during a dispute. A refund is impossible while
the attestor reports delivery.

### Timing (constructor parameters, immutable)

| Parameter | Demo value | ≈ at 300ms | Meaning |
|---|---|---|---|
| `commitBlocks` | 5 | 1.5s | `commitEnd = creationBlock + commitBlocks` |
| `revealBlocks` | 5 | 1.5s | `revealEnd = commitEnd + revealBlocks` |
| `payoutBlocks` | 2000 | 10 min | `payoutDeadline = revealEnd + payoutBlocks` |
| `disputeBlocks` | 200 | 60s | `disputeEnd = markPaidBlock + disputeBlocks` |
| `resolutionBlocks` | 2000 | 10 min | `resolutionEnd = disputeBlock + resolutionBlocks` |
| `collateralBps` | 11000 | Collateral locked for the leading bid, `ceil(bid × bps / 10000)`. Must be ≥ 10000 |
| `minStake` (registry) | 100 AUSD | Total active stake an LP needs before it may commit |
| `unstakeCooldown` (registry) | 86400 s | Wall-clock delay between `requestUnstake` and `withdraw` |

> **`disputeBlocks` is the only thing between a lying LP and the escrow when no attestor has
> spoken.** 150 blocks (~60s) is a demo value. Production is hours.

---

## 3 · Signed messages

### 3.1 AUSD `ReceiveWithAuthorization` (EIP-3009) — signed by the sender's passkey account

Domain: read from the token via EIP-5267 `eip712Domain()` — do **not** hardcode name/version.

```
ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)
```

| Field | Value |
|---|---|
| `from` | sender |
| `to` | `RailCore` address |
| `value` | `maxAusd + fee` |
| `validAfter` | `0` or now − 60 |
| `validBefore` | quote expiry (now + 120) |
| `nonce` | **`orderId`** from §3.2 |

Binding the order id into the nonce is what stops a relayer altering recipient, amount, currency,
fee or attestor: any change produces a different nonce and the token rejects the signature.

### 3.2 `OrderIntent` → `orderId`

Domain: `{ name: "Rail", version: "1", chainId, verifyingContract: RailCore }`

```
OrderIntent(address sender,bytes32 recipientCommitment,bytes3 currency,uint256 localAmount,uint256 maxAusd,uint256 fee,address relayer,address attestor,bytes32 salt)
```

`orderId = hashTypedData(domain, OrderIntent)` — in viem, `hashTypedData({ domain, types, primaryType: "OrderIntent", message })`.
Not signed on its own. `RailCore.hashIntent(intent)` returns the same value.

| Field | Meaning |
|---|---|
| `sender` | Passkey-derived EOA paying AUSD |
| `recipientCommitment` | §3.5 |
| `currency` | `bytes3`, e.g. `"NGN"` |
| `localAmount` | Exact local-currency minor units the recipient must receive |
| `maxAusd` | Reserve price. The most the sender will pay. Change returns to sender |
| `fee` | Relayer fee in AUSD units, paid at creation, non-refundable. May be 0 |
| `relayer` | Receives `fee`. Must be non-zero if `fee > 0` |
| `attestor` | `IAttestor` the sender accepts as evidence, or `address(0)` for optimistic-only |
| `salt` | Random `bytes32` so identical sends produce distinct orders |

### 3.3 `Dispute` — signed by the sender

Domain: same as §3.2.

```
Dispute(bytes32 orderId)
```

### 3.4 `Attestation` — signed by an attestor signer key

Domain: `{ name: "RailSignedAttestor", version: "1", chainId, verifyingContract: SignedAttestor }`

```
Attestation(bytes32 orderId,bytes32 evidenceHash)
```

`evidenceHash = keccak256(evidence bytes)` — the raw SMS body, confirmation record, or CRE report.
Evidence itself stays off-chain.

### 3.5 Recipient commitment

```
recipientCommitment = keccak256(abi.encode(string bankCode, string accountNumber, bytes32 salt))
```

`salt` is 32 random bytes generated on the sender's device. **Never unsalted.** In viem:
`keccak256(encodeAbiParameters(parseAbiParameters("string, string, bytes32"), [bankCode, accountNumber, salt]))`.
In viem on the service side: the same `encodeAbiParameters` call as the PWA.

### 3.6 Bid commitment

```
commitment = keccak256(abi.encode(bytes32 orderId, address lp, uint256 amount, bytes32 salt))
```

Includes `lp` so a copied commitment can't be revealed by anyone else. `RailCore.computeCommitment`
returns the same value. **The matcher persists `(orderId, amount, salt)` to disk before sending the
commit** — a lost salt is a lost bid.

### 3.7 Narration reference

```
narration = "RAIL" + uppercase(hex(orderId)[2..10])      // e.g. RAILA8F2C3D1
```

12 characters, alphanumeric only — survives banks that strip punctuation or truncate narration.
The LP puts this in the transfer narration; the SMS parser matches on it.

---

## 4 · Contracts

Solidity interfaces live in `contracts/src/interfaces/IRail.sol` and are authoritative for exact
signatures, events and errors. This section defines semantics.

### 4.1 `IERC3009` (subset of AUSD used by Rail)

```solidity
function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter,
    uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
```

### 4.2 `IAttestor`

```solidity
function isDelivered(bytes32 orderId) external view returns (bool);
```

**Positive-only.** An attestor can make an order settle sooner. It cannot cause a refund or a slash.
`RailCore` calls it by `staticcall` with a fixed gas stipend (`ATTESTOR_GAS = 50_000`), reads at
most 32 bytes, and treats revert / short return / anything other than `true` as "not delivered".
Callers of `finalize`/`refund` must supply enough gas for the stipend or the call reverts with
`InsufficientGas` — so a gas-starved call can't skip an attestation.

### 4.3 `RailCore`

```solidity
enum Status { None, Open, Awarded, Paid, Disputed, Settled, Refunded, Cancelled }

struct OrderIntent {
    address sender; bytes32 recipientCommitment; bytes3 currency; uint256 localAmount;
    uint256 maxAusd; uint256 fee; address relayer; address attestor; bytes32 salt;
}
struct Authorization { uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }

struct Order {
    address sender;  Status status; bytes3 currency; uint64 commitEnd;
    address winner;  uint64 revealEnd;
    address attestor; uint64 payoutDeadline;
    uint128 maxAusd; uint128 winningBid;
    bytes32 recipientCommitment;
    uint256 localAmount;
    uint64 disputeEnd; uint64 resolutionEnd;
}
```

| Function | Access | Effect |
|---|---|---|
| `createOrder(OrderIntent, Authorization) → bytes32 orderId` | anyone | Pulls `maxAusd + fee` via `receiveWithAuthorization` with `nonce = orderId`; pays `fee` to `relayer`; opens the order |
| `commitBid(bytes32 orderId, bytes32 commitment)` | `registry.isEligible(msg.sender)` | Stores/overwrites the LP's commitment |
| `revealBid(bytes32 orderId, uint256 amount, bytes32 salt)` | committed LP | Verifies commitment. Requires `0 < amount ≤ maxAusd`. If strictly lower than the leading bid (ties: earlier reveal keeps the lead): releases the previous leader's lock and locks `ceil(amount × collateralBps / 10000)` of the new leader's free stake — reverts if the LP can't cover it |
| `closeAuction(bytes32)` | anyone | `Open` past `revealEnd` → `Awarded` or `Cancelled` (refunds `maxAusd`) |
| `markPaid(bytes32)` | winner | `Awarded` → `Paid`, starts dispute window |
| `dispute(bytes32 orderId, bytes signature)` | sender, or anyone with the sender's `Dispute` signature (empty `signature` when `msg.sender == sender`) | `Paid` → `Disputed`, starts resolution window |
| `finalize(bytes32)` | anyone | → `Settled`. Pays `winningBid` to winner, `maxAusd − winningBid` to sender, releases collateral |
| `refund(bytes32)` | anyone | → `Cancelled` (no bid) or `Refunded` (default: returns `maxAusd` + slashed collateral to sender) |
| `claim(address account)` | anyone | Pays `claimable[account]` to `account` |
| `setCreatePaused(bool)` | owner | Gates `createOrder` **only**. Nothing else is pausable |

Views: `getOrder(bytes32) → Order`, `hashIntent(OrderIntent) → bytes32`,
`computeCommitment(bytes32, address, uint256, bytes32) → bytes32`, `commitmentOf(bytes32, address) → bytes32`,
`collateralFor(uint256 bid) → uint256`, `canFinalize(bytes32) → bool`, `canRefund(bytes32) → bool`,
`claimable(address) → uint256`, and the immutable parameters.

**Deferred payouts.** Every outbound AUSD transfer goes through `_pay(to, amount)`. If the token
reverts (recipient frozen, transfers paused) the amount is credited to `claimable[to]` and
`PaymentDeferred` is emitted — the order still completes. `claim` retries later.

### 4.4 `LPRegistry`

| Function | Access | Effect |
|---|---|---|
| `stake(uint256)` | anyone | `transferFrom` AUSD in; increases `staked` |
| `requestUnstake(uint256)` | LP | Moves `amount` from free stake to `pendingUnstake`; `unlockAt = now + unstakeCooldown` (a new request resets the timer) |
| `withdraw()` | LP | After `unlockAt`, transfers all `pendingUnstake` |
| `setRail(address)` | deployer, **once** | Links `RailCore`. No other admin exists |
| `lock(bytes32 orderId, address lp, uint256)` | `RailCore` | Requires free stake ≥ amount. One lock per order |
| `unlock(bytes32 orderId)` | `RailCore` | Releases a lock (outbid). No stats change |
| `settle(bytes32 orderId, uint256 volume)` | `RailCore` | Releases the lock; `settled += 1`, `volumeSettled += volume` |
| `slash(bytes32 orderId) → (address lp, uint256 amount)` | `RailCore` | Removes the locked amount from the LP's stake, transfers it to `RailCore`; `defaults += 1` |
| `recordCommit/recordReveal/recordWin(address lp)` | `RailCore` | Increment counters |

Views: `accountOf(lp) → (staked, locked, pendingUnstake, unlockAt)`, `freeStake(lp) = staked − locked`,
`isEligible(lp) = staked ≥ minStake`, `statsOf(lp) → Stats`, `reliabilityBps(lp) = (settled + 1) × 10000 / (settled + defaults + 2)`,
`lockOf(orderId) → (lp, amount)`.

`Stats { uint64 commits; uint64 reveals; uint64 wins; uint64 settled; uint64 defaults; uint128 volumeSettled; }`
— append-only, no setter.

### 4.5 `SignedAttestor is IAttestor`

| Function | Access | Effect |
|---|---|---|
| `attest(bytes32 orderId, bytes32 evidenceHash, bytes signature)` | anyone | Recovers signer from §3.4. Requires `signerLayer[signer] > 0`. Records the attestation if its layer is higher than the existing one. Permanent — no revocation |
| `setSigner(address signer, uint8 layer)` | owner | `layer` 1 = recipient confirmation (L1), 2 = SMS alert (L2), 3 = CRE (L3), 0 = remove |
| `isDelivered(bytes32) → bool` | view | `recordOf(orderId).layer ≥ minLayer` (and > 0) |

Immutable `minLayer` — deploy one instance per trust policy.

**L0 is not an attestor.** It's `RailCore`'s dispute window. A pluggable L0 could be unplugged; a
native one can't.

---

## 5 · Services

All services: JSON over HTTPS, error envelope below, `GET /healthz → 200 {"ok":true}`.

```json
{ "error": { "code": "QUOTE_EXPIRED", "message": "human readable" } }
```

Error codes: `BAD_REQUEST` `UNAUTHORIZED` `NOT_FOUND` `QUOTE_EXPIRED` `ACCOUNT_NOT_RESOLVED`
`COMMITMENT_MISMATCH` `INSUFFICIENT_BALANCE` `SIMULATION_FAILED` `SUBMISSION_FAILED` `NOT_WINNER`
`RATE_LIMITED` `INTERNAL`.

`INSUFFICIENT_BALANCE` is the one error whose envelope carries data, because a sender needs the
number to act on it:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "…", "data": { "required": "37650000", "available": "20000000" } } }
```

Both are decimal strings of AUSD units, as elsewhere in this document — a `bigint` does not survive
`JSON.stringify`, and a `number` loses precision above 2^53. It is distinct from
`SIMULATION_FAILED`, which it would otherwise be a subset of, for one reason: "you need $17.65 more"
is something a person can fix, and "this transfer would not go through" is not.

### 5.1 `rail-relayer` (TypeScript · Node + viem)

Sender-facing. Holds MON for gas and nothing else. One signer key.

The app calls this from a browser on another origin, so every response carries CORS headers for an
origin on the `ALLOWED_ORIGINS` allowlist (defaulting to `APP_BASE_URL`), and `OPTIONS` answers the
preflight with `204`. An origin not on the list gets no CORS headers — never `*`. This is not what
protects the 🔑bot endpoints; their shared secret is, because CORS only binds browsers.

| Endpoint | Body / query | Returns |
|---|---|---|
| `GET /v1/banks?currency=NGN` | — | `[{ code, name }]` |
| `GET /v1/accounts/resolve?currency=NGN&bankCode=058&accountNumber=0001234567` | — | `{ accountName }` via Paystack `GET /bank/resolve`. `ACCOUNT_NOT_RESOLVED` on failure |
| `GET /v1/quote?currency=NGN&localAmount=5000000` | — | `{ currency, localAmount, indicativeAusd, maxAusd, fee, relayer, attestor, rate, expiresAt }` |
| `POST /v1/account-links` 🔑bot | `{ waId }` | `{ url }` — `url = https://<domain>/l/<token>`, single use, expires in 15 min. Sent when a chat needs an account that does not exist yet |
| `POST /v1/accounts/link` | `{ token, address, signature }` | Binds a WhatsApp number to an account. `signature` is EIP-191 `personal_sign` over `"Rail link\ntoken: <token>\naddress: <address>"`, so the app proves it holds the passkey for `address`. Returns `{ waId, address }` |
| `GET /v1/accounts?waId=` 🔑bot | — | `{ address }`, or `NOT_FOUND` when the number has no account yet |
| `POST /v1/contact-links` 🔑bot | `{ waId, contactName }` | `{ url }` — `url = https://<domain>/k/<token>`, single use, expires in 15 min |
| `POST /v1/contacts` | `{ token, currency, bankCode, accountNumber }` | Resolves the name via Paystack, stores the contact against the link's `waId`. Returns `{ contactId, contactName, accountName, bankName, accountLast4 }` |
| `GET /v1/contacts?waId=` 🔑bot | — | `[{ contactId, contactName, accountName, bankName, accountLast4 }]` — **never the full number** |
| `POST /v1/contacts/forget` 🔑bot | `{ waId, contactId }` | Deletes that recipient. Scoped to the chat that owns it, so one chat cannot forget another's. Returns `{ forgotten: true }` |
| `POST /v1/drafts` 🔑bot | `{ waId, contactId, currency, localAmount }` | `{ draftId, url }` — `url = https://<domain>/c/<draftId>`. 128-bit random id, expires in 15 min |
| `GET /v1/drafts/:draftId` | — | `{ currency, localAmount, recipient: { bankCode, bankName, accountNumber, accountName } }` — the full number is shown only inside the PWA |
| `POST /v1/orders` | `{ intent, authorization, recipient: { bankCode, accountNumber, accountName, salt } }` | `{ orderId, txHash }`. Checks `balanceOf(intent.sender) ≥ maxAusd + fee` before simulating, so a short balance returns `INSUFFICIENT_BALANCE` with the shortfall rather than an opaque `SIMULATION_FAILED` |
| `GET /v1/balance?address=0x…` | — | `{ address, balance }` — AUSD units as a decimal string. Lets the app tell a sender they are short *before* asking them to approve anything, without needing an RPC of its own |
| `POST /v1/practice-dollars` | `{ address }` | **Testnet only** (chain 10143; refuses elsewhere with `BAD_REQUEST`). Calls Agora's AUSD faucet `requestFunds(address)` with the relayer paying gas, so an account holding no MON — every passkey account, and any wallet that only holds MON — can get practice dollars in one tap. The faucet itself caps it at once a minute and 100,000 held per address; a refusal returns `RATE_LIMITED`. Returns `{ txHash }`. Moves no money of the relayer's: the faucet pays, the relayer only pays gas |
| `GET /v1/orders/:orderId` | — | `{ orderId, status, winner, winningBid, maxAusd, change, narration, blocks: {...}, txs: [...] }` |
| `POST /v1/orders/:orderId/dispute` | `{ signature }` | `{ txHash }` |
| `POST /v1/orders/:orderId/payout-details` | `{ lp, issuedAt, signature }` | `{ bankCode, bankName, accountNumber, accountName, currency, localAmount, narration }` |

**`POST /v1/orders`** must, in order: recompute `orderId` from `intent`; verify
`recipientCommitment` against `recipient`; check `authorization.validBefore > now + 10`; simulate
`createOrder` with `eth_call`; store recipient details (encrypted at rest, keyed by `orderId`);
submit with explicit `gas = simulatedGas × 1.2`; return the hash without waiting for inclusion.

**`quote`**: `rate` is local-currency units per 1 USD as a decimal string. `indicativeAusd` =
`localAmount / rate` at the reference rate (median clearing price of the last 20 settled orders
for the currency, fallback to a configured rate). `maxAusd = indicativeAusd × (1 + RESERVE_BUFFER_BPS/10000)`.
`expiresAt = now + 120`.

**`payout-details`** authenticates the LP: `signature` is EIP-191 `personal_sign` over
`"Rail payout details\norder: <orderId>\nissuedAt: <issuedAt>"`; `|now − issuedAt| ≤ 120`; the
recovered address must equal `getOrder(orderId).winner` and the derived status must be `Awarded`,
`Paid` or `Disputed`. Otherwise `NOT_WINNER`.

**Sweeper** (background task, every `SWEEP_INTERVAL_MS`, default 20s): for every tracked order,
`refund` when `canRefund`, else `finalize` when `canFinalize`, and stop tracking it once its status
is terminal. Tracks every order `POST /v1/orders` submits, persisted at `SWEEP_FILE` (default beside
the vault, on the volume), and on start seeds every `Open`/`Awarded`/`Paid`/`Disputed` order from
`INDEXER_URL` if set. Sends through the same submission queue as orders, with `gas = estimate +
40,000`. These calls are permissionless — the sweeper is a convenience, never a dependency.
`GET /healthz` reports `{ ok, sweeping }`, the number of orders it is watching.

**Nonce management.** A single submission task owns the signer nonce: initialised from
`eth_getTransactionCount(signer, "pending")`, incremented locally per send, resynced on
`nonce too low`/`nonce too high`. Handlers enqueue onto one submission queue and await their turn.
Acceptance (R6): 20 concurrent `POST /v1/orders` produce 20 distinct nonces and 20 inclusions.

### 5.2 `rail-attestor` (TypeScript)

Holds attestor signer keys (one per layer). Never holds funds.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /v1/confirm` | `{ orderId, token }` | **L1.** `token = base64url(HMAC-SHA256(CONFIRM_SECRET, orderId))[0..22]`. Verifies, signs an `Attestation` with the L1 key (`evidenceHash = keccak256("recipient-confirm:" ‖ orderId ‖ unix)`), submits `attest` |
| `POST /v1/sms` | `{ device, sms: { from, body, receivedAt }, signature }` | **L2.** `signature` is the device key's EIP-191 signature over `keccak256(body) ‖ receivedAt`; `device` must be on the allowlist. Re-parses `body` server-side, extracts amount and narration, finds the order by narration, requires `amount == localAmount`, signs with the L2 key (`evidenceHash = keccak256(body)`), submits `attest` |
| `POST /v1/webhooks/mono` | Mono payload | Optional. Verifies signature header, matches LP debit on amount + narration, signs L2 |

The sweeper that used to be specified here lives in the relayer now (§5.1): this service was
replaced by the CRE workflow, and the sweeper went unbuilt with it until an empty auction stranded a
sender's escrow for a day.

The recipient confirmation link is `https://<domain>/r/<orderId>?t=<token>`, generated by the
relayer (same `CONFIRM_SECRET`).

### 5.3 `rail-matcher` — reference LP bot

```ts
export interface PriceSource {
  /** AUSD base units the LP wants in exchange for delivering `localAmountMinor`. */
  price(currency: string, localAmountMinor: bigint): bigint;
}

export interface PayoutRail {
  pay(orderId: Hex, details: PayoutDetails): Promise<PayoutReceipt>;
}
```

Implementations: `StaticRate { rate, spread_bps }`, `AzaQuote` (R20); `ManualPayout` (notifies the
operator, waits for their confirmation), `AzaPayout` (R20).

Loop per `OrderCreated`: filter by currency, max size and **attestor allowlist** → `price` → skip if
`bid > maxAusd` → persist `(orderId, bid, salt)` → `commitBid` → wait for `commitEnd + 1` →
`revealBid` → wait for `revealEnd + 1` → if `winner == self`: `closeAuction` if still `Open`, fetch
`payout-details`, `pay`, `markPaid`. Config via env: `LP_PRIVATE_KEY`, `RPC_URL`, `RAIL_CORE`,
`CURRENCIES`, `SPREAD_BPS`, `MAX_ORDER_AUSD`, `ATTESTOR_ALLOWLIST`, `RELAYER_URL`.

### 5.4 `bot` — the chat front door

One brain, two transports. `handle.ts`, `commands.ts`, `amounts.ts` and `messages/` know nothing
about which chat they are speaking into; a transport's only jobs are to authenticate inbound
traffic, hand over `(chatId, text)`, and deliver a string back.

| Transport | Inbound | Authenticated by | Needs a public URL |
|---|---|---|---|
| **Telegram** (pilot) | long poll `getUpdates`, or webhook | the bot token itself; webhook adds `X-Telegram-Bot-Api-Secret-Token` | **No** when long polling |
| WhatsApp Cloud API | webhook only | `X-Hub-Signature-256` HMAC-SHA256 over the raw body | Yes |

Telegram is first because it needs no business verification and no public URL: long polling means
the bot reaches out to Telegram rather than waiting to be called, so it runs anywhere. That is also
why the pilot can be demonstrated before Meta approves anything.

**`chatId` is opaque, and Telegram's is namespaced** — `tg:<telegram chat id>`. WhatsApp still sends
a bare number, which is safe because prefixing one side is enough: `tg:7301…` can never equal
`2349166358325`. Namespacing both would be tidier and is not a correctness requirement.

The relayer's wire field is still spelled `waId` and carries whichever id the transport produced.
The name is wrong now; renaming it across the relayer and its tests is tracked debt, deliberately
not done days before a deadline for zero behaviour change.

- `GET /webhook` — Meta verification (`hub.verify_token`), WhatsApp only.
- `POST /webhook` — reject unless the transport's check above verifies.
- Calls to 🔑bot relayer endpoints carry `Authorization: Bearer <BOT_API_KEY>`.
- **Structured commands only** — no open-domain assistant (banned on the Business Platform since
  15 Jan 2026). Amounts accept `50k`, `50,000`, `₦50000`. Anything else → `help`.

| Command | Does |
|---|---|
| `send <amount> to <contact>` | Builds a draft and returns the approval link |
| `add <contact>` | Returns a one-time link for entering their bank details |
| `contacts` | Who this chat can send to, last four digits only |
| `remove <contact>` | Forgets a recipient. Confirmed before it happens |
| `balance` | Reads the linked account on-chain, in dollars |
| `rate` | What a dollar is worth in local currency today, and where the number came from |
| `fund` | How to put money in: the account address, or a connected wallet |
| `about` | What Rail is, in three lines, with the link to the app |
| `help` | Every command above |

  `remove` is the only destructive one, so it asks first and acts on the reply. Everything else is
  read-only or produces a link that still needs a signature.
- `add <contact>` calls `POST /v1/contact-links` and replies with the link. **The bot never asks for,
  accepts, or echoes a full account number.** If a user pastes anything that looks like an
  account number, the bot doesn't store it and doesn't echo it back; it replies with how to add
  that person safely. It cannot reply with a contact link there, because a contact link is created
  against a name and the paste doesn't carry one.
- `send` calls `GET /v1/contacts` + `POST /v1/drafts` + `GET /v1/quote`, replies with account name,
  bank, `····<last4>`, amount in naira, indicative price in dollars, and the deep link.
- `balance` reads the linked account via `GET /v1/accounts`, reads its balance on-chain (read-only)
  and replies in dollars. An unlinked number gets an account link instead, never an error.

**The link proves the key, not the chat.** `POST /v1/accounts/link` requires a signature from the
account itself, so taking over a WhatsApp number or a Telegram account cannot attach it to someone
else's money, and the relayer never learns a private key. This is the property that makes it safe to
add transports at all: a new chat surface adds a way to *propose*, never a way to spend.
- Every user-visible string lives in `bot/src/messages` and passes the ban list in `CLAUDE.md`.
- **Never** holds a key, calls `POST /v1/orders`, or signs anything.

### 5.5 `web` — Next.js PWA

Route groups: `(marketing)` landing site · `(sender)` sender app · `(provider)` LP and explorer.
Design: `docs/DESIGN.md`.

| Route | Audience | Purpose |
|---|---|---|
| `/` | everyone | Landing site (`(marketing)`) — see `docs/DESIGN.md` §9 |
| `/start` | sender | Create an account with Face ID, or unlock one on a device that already has a passkey |
| `/account` | sender | Balance, add money, recent transfers |
| `/send` | sender | Amount + recipient → quote → Face ID → done |
| `/fund` | sender | Add dollars by card / Apple Pay / bank transfer via the embedded Ramp Network widget (AUSD on Monad; UK + US). Rail never touches the fiat |
| `/c/[draftId]` | sender | Confirm a WhatsApp draft → Face ID |
| `/k/[code]` | sender | Add a contact's bank details (from a WhatsApp `add` link) |
| `/connect` | sender | Connect an EVM wallet on Monad as the signing account, for people who already have one. Route group `(connect)`, exempt from the ban list per `CLAUDE.md` |
| `/l/[code]` | sender | Connect a WhatsApp number to this account — signs `"Rail link\ntoken: …\naddress: …"` and posts it to `POST /v1/accounts/link` (§5.1) |
| `/o/[orderId]` | sender | Live status |
| `/r/[orderId]` | recipient | "I received ₦X" one tap (L1) |
| `/provider` | LP | Connect a wallet, stake, see live requests, bid, collect the account number, mark paid. Route group `(provider)`, exempt from the ban list: a provider arrived with a wallet |
| `/explorer` | public | Auctions, clearing rates, settlement times (from indexer) |

The route segment is `[code]`, not `[token]`, while the wire field stays `token`: `token` is on the
`CLAUDE.md` ban list, and the ban list covers file paths under `(sender)`. `web/src/lib/rail-api.ts`
does the translation, so sender-facing code never spells the word.

**Two signers, one authorisation.** The sender signs with a passkey or with a connected EVM wallet,
and the bytes are identical either way: an EIP-712 `ReceiveWithAuthorization` over the AUSD domain
(§3.1), with the order id as the nonce. `RailCore` cannot tell them apart and must not be able to.

A connected wallet needs no funding step. The authorisation pulls exactly `maxAusd + fee` from the
sender's own wallet when the relayer submits, and `maxAusd - bid` returns on settlement — so the
money never leaves their custody until the escrow takes it, and only ever the amount they approved.

`web/src/lib/account/signer.ts` resolves whichever signer this device has; everything downstream
takes a `TransferSigner` and does not care which it got.

Passkeys: Mera, `rpId` = production domain, account path `m/44'/60'/0'/0/0`.

### 5.5.1 Sender passkey accounts (`web/src/lib/account`)

Chain access, the token address and every Mera call live under `web/src/lib/account`, never in
`(sender)` or `components/sender` — those paths must return zero hits on the `CLAUDE.md` ban list,
and identifiers like `monadTestnet` or `createWalletClient` would fail it.

**Derivation.** `@category-labs/mera` ≥ 0.2.0.

```
createPasskeyWithPrfOutput({ rp: { id: rpId, name: "Rail" }, user }) → prfOutput (32 bytes)
entropyToMnemonic(prfOutput) → mnemonicToSeedSync → HDKey.derive("m/44'/60'/0'/0/{index}")
→ secp256k1 private key → createSecp256k1SigningSession → toViemAccount (signs EIP-712 / EIP-3009)
```

| Index | Account |
|---|---|
| 0 | Spending account: holds AUSD, signs `ReceiveWithAuthorization` (§3.1) |
| 1 | Savings account (Mera "one passkey, many keys"). Same passkey, separate address |

**Both addresses are derived in the one ceremony that creates or unlocks the account**, from a single
PRF output. That is what makes the second account free: no extra passkey, no extra prompt, and the
balance of each is readable afterwards without any prompt at all, because reading needs no signature.

**Storage.** `localStorage` key `rail.account.v1`:
`{ version: 2, credentialId, transports?, address, savingsAddress, rpId }`. **The private key is
never persisted**, never leaves the tab, and exists only inside one signing session. A stored
`version: 1` record predates the savings account and has no `savingsAddress`; it is still valid, and
the next unlock fills it in.

**One Face ID per authorisation.** Every signature re-runs `getPasskeyPrfOutput({ rpId, credential })`,
derives the key, signs, then calls `session.end()`. There is no ambient session that could sign
without the user — this is the PWA half of invariant 2 in `CLAUDE.md`.

**`rpId`** is `NEXT_PUBLIC_PASSKEY_RP_ID`. Account creation is refused on any host that is neither
that value (or a subdomain of it) nor `localhost`/`127.0.0.1`, because a passkey binds permanently to
the `rpId` it was created for. A preview deployment must never mint an account.

**Failure states the UI must handle**, all shown in sender register (no crypto vocabulary):

| Cause | Meaning for the user |
|---|---|
| `PRF_UNAVAILABLE` (Mera) | This browser saved the passkey somewhere Rail can't use. Offer Safari/Chrome with iCloud Keychain, 1Password or Google Password Manager |
| `PASSKEY_OPERATION_FAILED`, cancelled, or WebAuthn missing | Face ID was cancelled or unavailable — offer retry |
| Host not allowed | Accounts are only created on the live site |
| No stored credential on this device | Offer "I already have an account" → `getPasskeyPrfOutput` with no `credential`, which lets the platform pick a discoverable passkey |

**Balance** is `balanceOf(address)` on AUSD over a public RPC (`NEXT_PUBLIC_RPC_URL`, default
`https://testnet-rpc.monad.xyz`), formatted as dollars from 6 decimals. Reading needs no signature
and no MON.

### 5.6 `android` — SMS attestor

Reads incoming SMS from an allowlist of bank sender ids, parses with the R8 corpus patterns, and
`POST /v1/sms` with a device key generated on first launch (address shown for allowlisting). On parse
failure it opens `/r/<orderId>` so the recipient can confirm manually (L1 fallback).

### 5.7 `indexer` — Envio HyperIndex

Entities: `Order` (all fields + status timeline + blocks), `Bid` (commit/reveal, amount, leading),
`LiquidityProvider` (stake, stats), `Attestation`, `CurrencyDayStat` (volume, count, median bid
rate, median settlement blocks). Sourced from the events in `IRail.sol` only.

The sender dashboard (`/account`) reads history from it by `sender` (`NEXT_PUBLIC_INDEXER_URL`), so an
account shows the same transfers on every device; the device's own list only covers the moments
before the indexer has seen a new order. The relayer's sweeper (§5.1) seeds itself from it too.
