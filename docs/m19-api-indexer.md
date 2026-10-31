# M19 — APIs, Durable Ledger Indexer and Replay/Reconciliation Foundation

**Status:** Source and tests implemented on Stellar Testnet in **read-only, candidate-observation mode**. The normal service is **DISABLED_NO_VERIFIED_DEPLOYMENTS** because all seven Hoxo contract roles are still `planned` with **null contract IDs** and no independent code-hash/deployment verification. No real exchange transactions, transfers into Hoxo collateral, funding settlements, accrued lending income, liquidations, volume or positions are produced by M19.

## RPC ingestion

`indexer/rpc.mjs` performs explicit canonical Stellar Testnet JSON-RPC handshake using `getNetwork`, `getHealth` and `getLatestLedger`. It rejects an incorrect network passphrase, unhealthy or stale ledger head, rewound ledger head or retention-window gap. Candidate-only observations, when *explicitly enabled by the operator*, scan contiguous ledger heights (up to 5 per poll), validate each ledger hash through `getLedgers`, obtain only allowlisted contract events through `getEvents`, and **recheck each hash before committing**. Incomplete event pages, cursor replay, duplicate event identifiers, impossible ledger numbers or missing coverage halt ingestion.

Event data is kept as **raw, undecoded base64 Soroban ScVal topic/value** with contract ID, role, transaction hash, event ID, RPC ledger and close time. Each record explicitly says `STELLAR_RPC_PROVIDER_REPORTED_CANDIDATE`, `txVerifiedIndependently:false`, `financialStateDerived:false`. An RPC response is an observed provider claim, **not independent cryptographic validation or proof a registered Hoxo exchange contract has been safely deployed**. No price candles, APY, yields or liquidation claims are inferred.

The default when starting at the current RPC tip gives only **partial retained history** (not complete genesis records). Backfills require an explicit start ledger within the RPC retention window. The system fails closed on network resets and ledger hash divergence; it does **not** automatically prune, rewrite, or silently reinterpret historical account balances. The needed signed transaction proof, Soroban TTL archival recovery, canonical event decoding, chain code verification and ledger-fork reconciliation remain future acceptance tasks.

## Durable store

`indexer/store.mjs` owns a locked `.jsonl` log (default `.data/hoxo-m19-events.jsonl`), fsyncs **one full scanned ledger per line**, and links entries by SHA-256 including a deterministic registry allowlist fingerprint. Restart verifies every line, sequential checkpoint number, contract set, event scope, event ID and hash. Partial writes and corrupted history halt; no auto-delete or replay over corrupted data. This is tamper-evident operational logging, **not tamper-proof trusted consensus**, and not a production-scale PostgreSQL/streaming indexer.

## REST and streaming API

`indexer/api.mjs` hosts a **loopback-only**, no-CORS, read-only API independently of the existing M8 signed sandbox service:

- `GET /health` and `GET /v1/indexer/status` — current ingestion state, checkpoint, hash, candidate provenance, disabled financial accounting and trading permission.
- `GET /v1/indexer/events?role=&contractId=&cursor=0&limit=25` — bounded, role-scoped raw RPC event envelopes; **not** financially interpreted positions.
- `GET /v1/indexer/checkpoints?cursor=0&limit=25` — provider-reported ledger hashes, scanned event counts and historical scanner checkpoints.
- `GET /v1/indexer/stream` — **Server-Sent Events (SSE)** notifications when a new ledger checkpoint is committed; bounded subscribers, no transaction authorization.

All `POST` calls are rejected (HTTP 405). No WebSocket gateway or user-authenticated private portfolio API has been built; SSE is the transport currently implemented. In the default disabled mode, endpoints return explicit disabled status/empty events rather than fictional transactions. Public RPC events are not private wallet proof.

## Run it safely

```sh
npm run test:indexer
npm run check:readiness
npm run dev:indexer
# GET http://127.0.0.1:8789/v1/indexer/status
```

**Default operation:** run `npm run dev:indexer` with no additional env flags. It serves `DISABLED_NO_VERIFIED_DEPLOYMENTS`, **makes no event scan requests** and accepts no wallet credentials. The main M8 matcher remains independently signed and disabled for settlement.

For **future, independently reviewed candidate metadata observation only**, a Testnet registry entry must be explicitly marked `candidate` with a properly formed deployment contract ID and transaction evidence, and an operator must set `HOXO_M19_OBSERVE_CANDIDATES=YES`. This **never** promotes a candidate to verified. Starting without preexisting checkpoints may use `HOXO_M19_START_LEDGER` within RPC retention; otherwise it starts at the then-current network tip. Set `HOXO_M19_JOURNAL` for persistent local storage and `HOXO_M19_PORT` to a loopback port. Operator must preserve journal backups and handle lock files after an interrupted shutdown. Do not configure an untrusted endpoint or expose this unreviewed server publicly.

## M19 validation

The new `tests/indexer.test.mjs` covers network handshake, RPC JSON-RPC identities, allowlisting and role scope, success-only event XDR preservation, record replay/dedup, per-ledger fsync, corruption detection, retention gaps, Testnet resets, forked ledger hashes, source separation, and local REST permissions. Existing M18 wallet-only Horizon transfers and signed off-chain M8/M17 history remain independent.

## Outstanding to call M19 operational

1. Independent verification of actual Stellar Testnet contract **deployments**, source bytecode hashes, implementation/upgrade authority and canonical asset issuers, and real signed wallet transaction hashes.
2. Canonical Soroban **ScVal event decoding** per deployed contract, cross-contract reconciliation of transfers/deposits, debt indices, perp positions, funding and PnL, and validation against live on-chain storage.
3. Production backfill/retention beyond the short RPC window, **Postgres/Neon storage**, event deduplication across provider changes, finalized-ledger policies, rollback and reorg governance, audit.
4. Authenticated account access where non-public state exists; **WebSocket** streaming and verified market-data feeds, production hosting and operational monitoring.
5. Independent end-to-end Testnet wallet tests and protocol/security audit.

**M19's indexer foundation is not an operational Hoxo market-data feed or exchange.**

## Verified build and security gate — 31 October 2026

[GitHub Actions M19 source/test run #41224344199](https://github.com/mushee-io/Hoxo-SS/actions/runs/41224344199) tests the on-disk ledger journal, RPC protocol handshake/scan, candidate-event checks, REST/SSE stream, ledger pagination, recovery and operator safety gates. All **20/20 dedicated M19 tests** and **144/144 total Node.js tests** passed; the unchanged Rust/Soroban source contracts and pinned Stellar CLI WASM builds also passed. A connected-wallet browser simulation and independent live read-only Stellar checks run in the same CI workflow.

The M19 API does not include a WebSocket server; the implemented streaming transport is **SSE**. The store is a candidate-only **provider-reported XDR event envelope journal**: it does not independently validate the transactions, decode canonical financial state, provide live Hoxo prices or derive account PnL. No Hoxo contract deployments have been verified. Normal operation remains **DISABLED_NO_VERIFIED_DEPLOYMENTS** and cannot be presented as an operational exchange.
