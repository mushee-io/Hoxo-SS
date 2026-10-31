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

## Milestones
1. Product/risk specification, deterministic account risk library and CI.
2. Soroban unified collateral vault, asset allowlist and authenticated deposits/withdrawals.
3. Spot execution adapter and verifiable settlement accounting.
4. Lending pool contracts (supply, borrow, accrual, liquidations).
5. Perpetual position and funding contracts, order matching and settlement.
6. Integration: unified collateral, synchronized risk invariants, oracle guards, keeper/liquidator.
7. Real testnet wallet flows, invariants/fuzz tests, independent audit and production readiness review.

See [architecture](docs/architecture.md), [risk model](docs/risk-model.md) and [delivery gates](docs/delivery.md).

## Local risk-engine checks
```sh
npm test
```

The JS reference engine is **not smart-contract authorization** and must not be used to safeguard funds on its own.

## Security
Do not fund unreviewed contracts. No admin or private keys in this repo. Avoid unauthenticated oracle writes and off-chain-only enforcement.