# Hoxo-SS

**Stellar-native spot, perpetual futures and money markets — one unified margin account.**

Hoxo-SS is a proposed non-custodial exchange for Stellar. The intended product combines:
- **Spot:** on-chain asset swaps and/or limit-order execution with settled token balances.
- **Perpetual futures:** USDC-settled synthetic exposures, funding, mark-price margin checks and liquidations.
- **Money markets:** supply, redeem, borrow and repay with risk-controlled collateral usage.
- **Unified margin:** a single collateral ledger and conservative account-wide risk calculation.

**Status: early development.** M4 read-only Stellar Testnet RPC + Horizon infrastructure has been verified in GitHub CI, but this repository is not a deployed exchange. No exchange smart contracts, user funds, production trading, or audited risk model should be assumed. Testnet-first. No synthetic volumes or fake live market data.

## Technical direction

Stellar smart contracts (Rust `soroban-sdk`) for vaults, settlement and enforcement; deterministic fixed-point shared risk math; oracle staleness checks; off-chain matching and indexer where necessary; wallet-signed Stellar transactions. A single risk-accounting specification must govern spot, perps and lending, and state-changing actions must be enforced **on-chain**, never merely by frontend checks.

## Product experience

- [Landing page](index.html): Nado-inspired original visual identity for HOXO SS.
- [Stellar Testnet trading terminal](app/index.html): responsive market workspace, Freighter-approved wallet identity, Testnet-only Horizon account balances and explicit not-deployed states for trading and lending.
- [M3 wallet verification and manual acceptance plan](docs/m3-wallet.md): strict Testnet validation, wallet-session lifecycle, guarded Friendbot and real-extension test criteria.
- [M4 Testnet infrastructure](docs/m4-infrastructure.md): verified Horizon + Stellar RPC, configurable HTTPS endpoints, read-only diagnostic terminal and undeployed contract registry.
- [M8 Sandbox Matching Engine](docs/m8-matching.md): signed off-chain testnet-domain order intents, price/time matching, self-trade prevention, cancellation and deterministic restart replay. **No orders are settled or risk-authorised.**
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

## Verification
```sh
npm test                   # Deterministic M0–M4 tests
npm run check:registry     # Validates canonical Testnet asset/contract registry
npm run check:testnet      # Live read-only Stellar Testnet Horizon check
npm run check:infra        # Live read-only Stellar RPC + Horizon + registry gate
npm run test:matching      # Signed matching journal and HTTP sandbox tests
npm run dev:matching      # Local sandbox API on 127.0.0.1:8788 (NO exchange execution)
```

The live check requires internet access and **does not** prove deployed exchange contracts.

The JS reference engine is **not smart-contract authorization** and must not be used to safeguard funds on its own.

## Security
Do not fund unreviewed contracts. No admin or private keys in this repo. Avoid unauthenticated oracle writes and off-chain-only enforcement.