# Hoxo-SS

**Stellar-native spot, perpetual futures and money markets — one unified margin account.**

Hoxo-SS is a proposed non-custodial exchange for Stellar. The intended product combines:
- **Spot:** on-chain asset swaps and/or limit-order execution with settled token balances.
- **Perpetual futures:** USDC-settled synthetic exposures, funding, mark-price margin checks and liquidations.
- **Money markets:** supply, redeem, borrow and repay with risk-controlled collateral usage.
- **Unified margin:** a single collateral ledger and conservative account-wide risk calculation.

**Status: early development.** This repository is not a deployed exchange. No contracts, user funds, production trading, audited risk model or live Stellar integration should be assumed. Testnet-first. No synthetic volumes or fake live market data.

## Technical direction

Stellar smart contracts (Rust `soroban-sdk`) for vaults, settlement and enforcement; deterministic fixed-point shared risk math; oracle staleness checks; off-chain matching and indexer where necessary; wallet-signed Stellar transactions. A single risk-accounting specification must govern spot, perps and lending, and state-changing actions must be enforced **on-chain**, never merely by frontend checks.

## Product experience

- [Landing page](index.html): Nado-inspired original visual identity for HOXO SS.
- [Stellar Testnet trading terminal](app/index.html): market workspace with wallet connection, read-only Horizon balance and ledger data, explicit not-deployed states for trading and lending.
- [Full development roadmap — M0–M24](docs/milestones.md): 25 stages from product design to audited mainnet readiness, with verifiable acceptance gates.
- [Architecture](docs/architecture.md), [risk model](docs/risk-model.md), [delivery gates](docs/delivery.md).

### Milestone summary

| Phase | Milestones |
| --- | --- |
| Foundation and interface | M0–M4 |
| Exchange and spot execution | M5–M9 |
| Lending and perpetuals | M10–M14 |
| Unified margin and portfolio | M15–M18 |
| APIs, security, testnet beta and readiness | M19–M24 |

**Important:** the terminal is a testnet development UI, **not** a deployed trading protocol. It does not submit orders, transfer collateral or show invented order-book/price data. The reference risk library is not contract enforcement.

## Local risk-engine checks
```sh
npm test
```

The JS reference engine is **not smart-contract authorization** and must not be used to safeguard funds on its own.

## Security
Do not fund unreviewed contracts. No admin or private keys in this repo. Avoid unauthenticated oracle writes and off-chain-only enforcement.