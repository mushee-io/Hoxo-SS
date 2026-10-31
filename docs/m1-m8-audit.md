# HOXO SS — M1–M8 implementation audit (31 October 2026)

**Reference:** GitHub branch `feat/unified-margin-foundation`, draft [Pull Request #1](https://github.com/mushee-io/Hoxo-SS/pull/1), not default `main`.

| Milestone | Evidenced code | Current acceptance gap |
| --- | --- | --- |
| M1 | Responsive landing, network health badge, mobile nav, tests | No public hosted visual acceptance; Vercel create-project 403 |
| M2 | Market picker, Spot/Perp panels, ticket drafts, Chromium tests | No verified Hoxo market/real orders; device/browser testing in actual deployment |
| M3 | Freighter API approval, passphrase/StrKey verification, Horizon holdings and explicit Friendbot flow | Only mocked extension/browser testing; actual wallet authorisations and funded wallet transactions unverified |
| M4 | Live RPC/Horizon passphrase, health and ledger cross-check; strict registry | No Hoxo deployed contract IDs or independently verified contract instances |
| M5 | Live *unrelated network* SDEX trade observations, canonical issuer/pair validation, OHLC/book parsers, mathematical oracle review | Zero approved asset pairs; no authenticated live on-chain index/mark oracle; all risk-pricing disabled |
| M6 | Soroban token vault source: admin constructor, approved deposits, owner-only withdrawals, per-account amounts, total accounting, TTL maintenance | 5/5 Soroban contract tests pass (including unauthorised-withdraw and unauthorised-admin rejection); still needs WASM release build, deployment, issuer approval and **real signed Testnet deposit/withdrawal** |
| M7 | Shared deterministic Rust portfolio math + Soroban preview interface; no permission to trade or withdraw | 14/14 Rust math and 2/2 Soroban preview tests pass; caller-provided snapshots still prevent canonical margin enforcement |
| M8 | Signed matching-intent engine with price/time FIFO, partial fills, cancel/replace, local durable journal and loopback API | Order matches are explicitly **unsettled**; no funds, smart contract settlement, cross-product margin reservations or distributed exchange hosting |

### Safety facts

- **All Hoxo-SS exchange contract IDs remain unset** in `registry/testnet.json`; do not confuse healthy Stellar RPC with a deployed protocol.
- M3 wallet holdings are not vault collateral, margin, borrowed funds or trading balances.
- M5 observations come from independent Stellar Testnet markets and may be absent or unrelated to displayed references; an on-chain authenticated oracle does not exist.
- M6 is currently an isolated account ledger, **not a unified-margin vault**. Persistent storage has TTL/rent and requires a defined keeper/archival recovery policy before a public deposit programme.
- M7 cannot enforce margin until custody/debt/perp/order balances and fresh oracle state are read atomically in the same contract invocation. Its approval methods reject every action.
- M8 is a non-executable off-chain sandbox. Even a mathematically matching order is not a Stellar settlement or real fill.
- External audit, testnet deployment verification, incident response and production readiness are not demonstrated.

### Release dependencies, in order

1. With Rust unit tests passing, build valid `wasm32v1-none` WASM with a compatible Stellar CLI, record checksums and review contracts.
2. Obtain a dedicated, independently controlled **Stellar Testnet** operator wallet and reviewed valueless test assets, perform legitimate deploy transactions, capture transaction hashes and registry entries.
3. Connect a signed/authenticated on-chain oracle and define asset-level risk and rate limits. Demonstrate stale/deviation failures.
4. Integrate the on-chain M6 vault with a rewritten M7 risk authority that uses canonical live state. Prove safe deposit, withdraw and order reservation with separate wallets.
5. Build M9 settlement so the M8 off-chain matches become fully authorised, replay-resistant, atomic Testnet token settlement; reconcile receipts and ledger state.
6. Run independent security audits and end-to-end multiwallet Testnet workflows before enabling deposit/trade buttons or a public beta.
7. Restore Vercel project creation permission for an isolated `hoxo-ss` deployment (or use another approved hosting destination), and manually test Freighter in a real browser.

Run `npm run check:readiness` to verify code-level no-live-execution invariants. This does **not** replace on-chain proof.

## Verified build evidence

On 31 October 2026, [GitHub Actions run 41191757442](https://github.com/mushee-io/Hoxo-SS/actions/runs/41191757442) passed **all six** jobs: 76/76 JS tests, 8/8 Chromium smoke tests, 14/14 `hoxo-risk-math` tests, 3/3 `hoxo-collateral-vault` tests, 2/2 `hoxo-risk-gate` tests, read-only Horizon and RPC Testnet checks, and M8 signed matching journal/API tests.

Rust packages use pinned patched `soroban-sdk=29.0.1`. This demonstrates native contract tests, **not** a compiled deployable WASM artifact or actual Testnet contract invocation. Stellar's published CLI 28.1.0 predates SDK29; verify a compatible Stellar CLI major version before attempting the recommended `stellar contract build`. The Bell Protocol 30 Testnet vote is scheduled for 3 November 2026; repeat network/SDK compatibility checks after that event.

## M6 authorisation regression — 31 October 2026

[GitHub Actions run 41192089391](https://github.com/mushee-io/Hoxo-SS/actions/runs/41192089391) verifies that the M6 vault rejects owner withdrawals and admin pauses when Soroban's test authorisation mocks are explicitly disabled (`Env::set_auths(&[])`). This increases confidence that authentication checks are present, but is still not a real signed Testnet transaction from an independent wallet.
