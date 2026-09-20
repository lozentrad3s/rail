# CLAUDE.md — Rail

Rail is a permissionless FX marketplace on Monad. Senders escrow AUSD; liquidity providers (LPs)
compete in a sealed-bid commit–reveal auction to deliver local currency bank-to-bank from their own
accounts; escrow releases when the payout is attested, and a defaulting LP's collateral is slashed
to the sender.

**This file governs the repo.** Every change is checked against it. If a task contradicts it, the
task is wrong — stop and flag it rather than implementing it.

`docs/INTERFACES.md` is the contract between modules. Change the interface doc first, then the code.
Never invent a type, error, endpoint or event that the interface doc doesn't define.

---

## Invariants — never violate

1. **Rail never holds, moves, or touches fiat.** No contract, service, or bot may custody local
   currency or initiate a fiat payout on a user's behalf. LPs (including AZA as LP #0) pay out on
   their own accounts and licences. Any design where Rail custodies fiat is rejected.
2. **WhatsApp proposes; the passkey authorises.** The bot never holds a signing key, never holds a
   session, and never submits anything that moves funds. It returns a deep link; the PWA signs.
   The bot never asks for, accepts, or displays a full bank account number — Meta's policy forbids
   requesting financial account numbers in chat. Account details are entered in the PWA via a
   link; chat shows `····4471` only. The bot is a structured payments bot (commands and intents),
   never a general-purpose AI assistant — those are banned on the WhatsApp Business Platform.
3. **No PII on-chain.** Bank details appear on-chain only as a salted `keccak256` commitment.
   Unsalted commitments are forbidden — a 10-digit NUBAN is brute-forceable in seconds.
4. **`finalize`, `refund` and `claim` are permissionless.** No owner, pause, allowlist or backend
   may block them. "What if your backend dies?" → "Nothing. Anyone can finalize."
5. **The sender captures the auction saving.** On settlement the LP receives exactly its winning
   bid; `maxAusd - bid` returns to the sender. The protocol takes no cut of the spread.
6. **An LP always has more locked than it could steal.** The leading bid is collateralised at
   `collateralBps` (≥ 100%) before it can win. Slashed collateral goes to the wronged sender, not a
   treasury.
7. **Reputation is derived, never written.** LP stats are append-only counters incremented only by
   `RailCore`. No setter, no admin override.
8. **The optimistic layer (L0) is never removed.** It lives natively in `RailCore` as the dispute
   window so no configuration can unplug it. Attestors can only accelerate settlement, never block it.
9. **One signature from the sender.** Order parameters are bound into the EIP-3009 `nonce`; a
   relayer cannot alter recipient, amount, currency or attestor.

## Contract rules (`contracts/`)

- Solidity **0.8.26**, pinned. Foundry. OpenZeppelin v5 for primitives only.
- **`receiveWithAuthorization`, never `transferWithAuthorization`.** The latter is front-runnable.
- **Auction and settlement windows are in block numbers, not timestamps.** Monad timestamps have 1s
  granularity and a 2s phase can't be expressed in them. Human-scale cooldowns (24h unstake) use
  timestamps.
- Every AUSD transfer can revert for reasons outside Rail (`isAccountFrozen`, `isTransferPaused`,
  `isSignatureVerificationPaused` — verified on the live implementation). Outbound payouts go through
  `_pay`, which defers to a pull balance (`claimable`) instead of bricking an order.
- Checks–effects–interactions on every fund-moving function, plus `nonReentrant`.
- Custom errors, not revert strings. An event on every state transition (the indexer depends on it).
- NatSpec on every external function.
- External calls to sender-chosen addresses (attestors) are gas-capped `staticcall`s that copy at
  most 32 bytes of return data. A misbehaving attestor reads as "not attested".
- Keep every contract under 24KB.

### Tests

- **Attack tests before implementation.** Every fund-moving path gets its adversarial test written
  first, in `contracts/test/*.attack.t.sol`. If a task doesn't name the attacks the code must
  survive, it isn't ready.
- When a test fails, **fix the contract, not the test**, unless the test contradicts this file or
  `docs/INTERFACES.md` — then say so explicitly.
- Every attack test has a one-line comment stating the attack in plain English.

## Services (`services/`) — TypeScript

Rust was the original choice and the interfaces were written for it. It was dropped on 20 Sep 2026
because this project's only machine has 4GB of RAM and no Windows SDK, so nothing could link and
every `alloy` rebuild cost minutes we don't have before 14 Oct. The language is not what is being
judged; a working pilot is. The rules that mattered survive the move.

- npm workspace, TypeScript, `viem` for chain access, `node:test` for tests. Node runs `.ts`
  directly (type stripping), so there is no build step — `tsc --noEmit` is the type gate.
- **Type stripping erases types, it does not compile them.** No parameter properties
  (`constructor(private x: T)`), no `enum`, no `namespace` — Node rejects all three at load. Use
  explicit fields, `as const` objects, and `.ts` extensions on relative imports.
- **Typed errors, never bare throws on a request path.** One error type per service, with the codes
  `docs/INTERFACES.md` §5 defines. No `any` in anything that touches money.
- **Monad charges the declared `gasLimit`, not gas used.** Set an explicit `gas` on every
  transaction, derived from a measured estimate plus a fixed margin — never the node default.
- The relayer is stateless with respect to funds: it holds MON for gas and nothing else.
- Webhooks (Paystack, WhatsApp, Mono) are hostile until the signature verifies.
- Paystack amounts are in **kobo**. AUSD has **6 decimals**. Convert at the boundary, name the unit
  in the variable (`amountKobo`, `amountAusdUnits`). Chain amounts are `bigint`, never `number` — a
  float rounding error here is somebody's money.
- Secrets come from environment variables only. Never log them, never commit them.

## Sender UI (`web/`) and WhatsApp bot (`bot/`) — the ban list

The sender never sees crypto vocabulary — in the PWA or in WhatsApp. Beyond UX, WhatsApp's commerce
policy forbids promoting the buying, selling or trading of virtual currency, so a crypto word in a
bot message is a ban risk for the number. This must return zero hits in sender-facing UI code and
in every user-visible bot string:

```bash
grep -rniE "wallet|gas|blockchain|crypto|seed phrase|mnemonic|web3|on-chain|onchain|token|stablecoin|usdt|usdc|ausd|\bMON\b|monad|metamask|tx hash|transaction hash|sign(ing)? (a )?message" "web/src/app/(sender)" web/src/components/sender bot/src/messages
```

Allowed: "Face ID", "passkey", "dollars", "digital dollars", "secure". LP-facing pages are exempt —
LPs already have wallets. The landing site (`web/src/app/(marketing)`) has two registers: the hero
and every call to action follow the ban list; the protocol and Monad chapters may use precise terms
for judges and builders (see `docs/DESIGN.md` §8).

## Design (`web/`)

`docs/DESIGN.md` governs every visual and motion decision — tokens, type scale, springs, materials,
components, voice. Use its tokens; never hardcode a hex, duration or easing in a component.
Simulations are labelled as simulations and targets as targets; never imply a partner, licence or
number we don't have.

- The Mera passkey `rpId` is the production domain from day one. Never create passkeys on a preview
  or `vercel.app` domain — accounts bind permanently to their `rpId`.
- Four taps for a send: amount+recipient → quote → Face ID → done.

## Git

- Commit small and often — judges verify work happened inside 1 Sep – 13 Oct 2026.
- Conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- Never commit `.env`, private keys, or the bank-alert corpus if it contains real account numbers
  (redact to `XXXXXX1234`).

## Commands

```bash
forge build                      # compile
forge test -vvv                  # all tests
forge test --match-path "contracts/test/*.attack.t.sol"
forge fmt                        # format
npm test --workspaces            # services (from services/)
npm run typecheck --workspaces   # services type gate
```
