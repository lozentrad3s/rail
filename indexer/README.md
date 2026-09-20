# Rail — indexer (Envio HyperIndex)

Reads Rail's events from Monad testnet and serves them as GraphQL: orders and their timelines,
every bid, provider stake and reputation, attestations, and per-currency daily numbers.

It is a **read model**. Every field is reconstructed from an event in
[`IRail.sol`](../contracts/src/interfaces/IRail.sol) — nothing is written by hand and nothing here is
a second source of truth about money. If a number cannot be derived from the chain, it does not
belong in this schema.

## What it feeds

- the public explorer (`/explorer`)
- the live auction on the landing page, replacing the simulation once there are real auctions
- the pilot numbers in the write-up: volume, what senders saved, median settlement time

## Running it

**The Envio CLI does not run on Windows.** It ships binaries for Linux and macOS only
(`envio-linux-x64`, `envio-darwin-arm64`, …), which is why the official docs tell Windows users to
use WSL. On a 4GB Windows machine, neither WSL nor Docker is a good trade, so this indexer is
developed here and **built and run by Envio Cloud**, which is Linux.

Docker is only needed to run an indexer *locally*: "You can skip installing Docker if you'll only be
using Envio Cloud."

| Where | Command | Needs |
|---|---|---|
| Envio Cloud (what we use) | push to the deployment branch | GitHub app installed on the repo |
| Linux/macOS/WSL | `pnpm codegen` then `pnpm dev` | Docker for the local Postgres and Hasura |

### Validating without the CLI

`npm run check` confirms the two things that silently break an indexer: that every event signature
in `config.yaml` matches the deployed ABI byte for byte (compared by topic hash), and that the
config parses with every contract given an address. Typos in a signature don't error — they just
index nothing, forever.

## Deploying to Envio Cloud

1. Log in at [envio.dev/app](https://envio.dev/app) with GitHub and install the Envio Deployments app
2. Add the indexer, pointing it at this repository with **root directory `indexer`** and config
   `config.yaml`
3. Push to the deployment branch; Envio builds, runs codegen and starts indexing from
   `start_block`

The free tier deletes deployments after 30 days, and after 7 days of inactivity — so deploy or
redeploy close enough to judging (14–27 Oct) that it is still alive.

## Addresses

From [`docs/DEPLOYMENTS.md`](../docs/DEPLOYMENTS.md), Monad testnet (`10143`), starting at the
deployment block `63549435`:

| Contract | Address |
|---|---|
| `RailCore` | `0xf0A34887d703300FA73533678A4a1f9D3B68c27F` |
| `LPRegistry` | `0xbcbB919329A3f86ddC6A3c948788201c2fD48b5a` |
| `SignedAttestor` | `0x2D6637D0F9C89648B39eF5f776E9923734C8CFdA` |
