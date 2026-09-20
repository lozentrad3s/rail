# Rail — Chainlink CRE workflow

**Status: starter scaffold, simulating. The attestation logic is not written yet.**

This is the `hello-world-ts` template from `cre init`, kept as the foundation for Rail's layer-3
attestor (task E3 in the build plan). It proves the toolchain works end to end — compile to WASM,
simulate, read the workflow's own log line — before any Rail logic depends on it.

```bash
cd cre
cre workflow simulate payout-attestor --target staging-settings --non-interactive --trigger-index 0
```

## What it will become

Rail settles an order early when an attestor says the payout reached the recipient. Layer 1 is the
recipient tapping a link, layer 2 is a parsed bank alert, and **layer 3 is a CRE workflow**: a
decentralised oracle network checks a payout feed and signs the result, so no single Rail server is
trusted with the claim that money arrived.

The workflow will:

1. trigger on a schedule (or on an `OrderAwarded` log from `RailCore`),
2. query a bank payout feed for the order's narration reference (`RAIL********`),
3. reach consensus across nodes on whether the exact local amount was paid,
4. write an `Attestation` to `SignedAttestor` on Monad, at layer 3.

**The feed will be a test feed, and every screen and write-up must label it as one.** We have no
bank data partnership, and implying otherwise would be dishonest.

Rail's design keeps this safe: an attestor can only ever make settlement happen *sooner*. A CRE
workflow that breaks, lies or disappears cannot cause a refund, cannot slash a provider, and cannot
strand an order — `RailCore` calls it through a gas-capped staticcall and treats anything other
than a clean `true` as "not delivered".

## Deployment

Deploying needs CRE Early Access approval, which is not enabled on this account yet. Request it with
`cre account access`. Simulation needs no approval.

## Files

| Path | What |
|---|---|
| `payout-attestor/main.ts` | Workflow entry point — currently the template's cron handler |
| `payout-attestor/config.staging.json` | Schedule and (later) the feed URL, order source and contract addresses |
| `payout-attestor/workflow.yaml` | Per-target workflow name and artifact paths |
| `project.yaml` | RPC endpoints per target. Monad goes here when the workflow writes on-chain |
| `secrets.yaml` | Secret **names** only. Never values |
| `.env` | Gitignored. Holds `CRE_ETH_PRIVATE_KEY` for chain-write simulation |
