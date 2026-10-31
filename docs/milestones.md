# Hoxo-SS — full milestone roadmap

**North star:** a Stellar-native, Nado-style central trading terminal offering spot, perpetual futures and money markets with real **on-chain unified margin**. All initial execution and deployments must use **Stellar Testnet**, not mainnet.

This plan deliberately distinguishes a rendered interface, a read-only wallet integration, real signed on-chain transactions and audited protocol readiness. A feature is not complete until its acceptance gate is evidenced in CI, ledger transactions or audits.

## Phase 1 — Product and experience

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M0 | Architecture and reference risk engine | Written spec; unit tests for fixed-point math, collateral, PnL and margin pass | Complete (reference model only) |
| M1 | Nado-inspired landing page | Responsive landing, responsive menu, terminal navigation, live Horizon passphrase/ledger check that fails closed, no misleading market data | Implemented; automated tests added; deployment and visual verification pending |
| M2 | Trading terminal skeleton | Searchable reference markets, Spot/Perp context, chart/book/timeframes, input-only order drafts, portfolio/account views; no fake market activity | Implemented in code; browser preview verification still pending |
| M3 | Freighter wallet and balances | Freighter extension API, strict Testnet/StrKey checks, verified Horizon holdings, refresh/disconnect and guarded Friendbot; no signing | Implemented; 38/38 unit and 7/7 Chromium tests passed, real Freighter acceptance and hosted preview pending |
| M4 | Stellar Testnet infrastructure | Strict Testnet RPC/Horizon handshake, health/ledger reconciliation, public HTTPS configuration, Friendbot safeguard, registry, browser diagnostics and CI | Implemented; 51/51 tests, 8/8 Chromium, live RPC + Horizon verified in CI; hosted visual acceptance pending |

## Phase 2 — Protocol core

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M5 | Oracle and market-data layer | Testnet-only Horizon SDEX trade/aggregation adapters, issuer validation, fixed-point candles/book parsing; oracle freshness/deviation review and kill switch | Partial: code and tests; no approved on-chain oracle, canonical mark/index, verified issuer pair, or actual HOXO fills |
| M6 | Soroban collateral vault | Constructor-authenticated admin, allowlist, signed token deposits, owner withdrawals, per-account totals, solvency checks and storage-TTL maintenance | Implemented and 5/5 Soroban tests passed (including unauthorised-call rejection); no WASM release build, real Testnet deployment or signed wallet acceptance |
| M7 | On-chain portfolio risk | Initial/maintenance margin, haircuts, debt, funding, PnL and order-reservation previews; hard-disabled spend/trade authorisation pending canonical state | 14/14 Rust math + 2/2 Soroban preview tests passed; NOT atomic margin enforcement, no deployment |
| M8 | Price-time order-book engine | Signed Testnet-domain order intents, deterministic price/time matching, cancel/replace, self-trade prevention, append-only hashed replay journal, loopback API | Implementation committed for CI; no settlement or on-chain reservation; M5–M7 dependencies outstanding |
| M9 | Spot-market settlement | Testnet-locked bilateral Soroban DvP, two-wallet authorisations, integer limit checks, exact transfers, ledger expiry, replay-proof receipt; M8 preview handoff | 12/12 Soroban contract tests, 4/4 M8→M9 preview tests, signed-authorization negatives, official CLI WASM build passed; guarded official-SDK two-wallet Testnet preflight/auth/receipt flow and mock tests added; no deployed Hoxo contract or genuine settlement receipt yet |

## Phase 3 — Lending and perpetuals

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M10 | Money market supply | Single Testnet-only Soroban pool with audited-intent shares, owner-auth deposits/withdrawals, reserve and solvency tracking, supply cap, pause, TTL, rate curve preview, borrowing forbidden | Native Soroban tests 16/16 and official Stellar CLI optimized WASM build pass; supply-only contract, no real Testnet deployment, asset approval, deposit, borrowing or yield |
| M11 | Borrowing and repayment | Account-scoped indexed debt shares, per-second interest index accrual, protocol reserves, debt caps, utilisation cap, mandatory canonical on-chain risk-authority check, borrower-signed origination, payer-signed repayments and expiry-safe keeper | Contract and test suite implemented; borrowing paused at zero cap by default; no audited/deployed canonical M5/M7 risk oracle, no signed Testnet loan or cross-product risk acceptance |
| M12 | Perpetual clearinghouse | Sign and settle actual testnet long/short positions with margin reservation | Not started |
| M13 | Funding and settlement | Mark/index price separation, funding updates, realised PnL, fees, reconciliation | Not started |
| M14 | Liquidations and insurance | Maint margin checks, partial/full liquidation, keeper incentives, insurance and bad debt | Not started |

## Phase 4 — Unified-margin experience

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M15 | Cross-product collateral | Eligible collateral reused within one canonical account safely; open orders reserve collateral | Not started |
| M16 | Portfolio-wide risk analytics | Health factor, stress tests, liquidation estimates, exposure caps and isolated fail-closed rules | Not started |
| M17 | Advanced order controls | Market/limit, reduce-only, TP/SL, conditional orders and auditable order transitions | Not started |
| M18 | Portfolio and history | Authenticated positions, PnL, funding, interest, transfers, order and trade history | Not started |

## Phase 5 — Operational testnet and release

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M19 | APIs and indexer | REST/WebSocket, replay/reorg reconciliation, durable logs, real market feeds | Not started |
| M20 | Security and controls | Threat model, role minimisation, rate limits, pause controls, oracle outages, auth abuse testing | Not started |
| M21 | End-to-end testnet verification | Separate funded wallets perform real deposit→spot→borrow→perp→liquidate/repay→withdraw flows | Not started |
| M22 | Audit and chaos testing | Invariants, fuzz/property tests, economic stress, external review and findings resolved | Not started |
| M23 | Public testnet beta | Repeatable deployment, faucet, live telemetry, docs, responsible-disclosure policy, real demo transactions | Not started |
| M24 | Mainnet readiness | External risk/security approval, governance and liquidity plan, runbooks and separate launch decision | Not started |

## Hard dependencies

- **M5–M7** must precede any permission to use unified collateral in on-chain trading or lending.
- **M8–M9** need authenticated, replay-safe order/settlement execution; a displayed order book is not a matching engine.
- **M10–M14** must use the canonical accounting from M6/M7 and enforce safeguards inside smart contracts.
- **M15** is the integration milestone proving true unified margin; three independent balances do not qualify.
- **M21–M23** require reproducible Stellar Testnet transaction hashes, not simulations or invented volume.
- **M24** is explicitly not an automatic mainnet deployment; risk parameters in the JavaScript reference model are educational placeholders.

## Implementation principles

1. Match Nado's **workflow quality**, not its branding or proprietary assets.
2. Use Stellar native Testnet network passphrase `Test SDF Network ; September 2015`; Horizon `https://horizon-testnet.stellar.org`; Soroban RPC `https://soroban-testnet.stellar.org`.
3. The Testnet reset schedule requires rechecking all contracts and assets after network resets.
4. All wallets remain non-custodial and user signatures are mandatory for spending.
5. Testnet analytics must never be presented as live mainnet market data, real liquidity, PnL or TVL.
6. Every risk-affecting action must pass fresh on-chain state validation before an atomic mutation.
