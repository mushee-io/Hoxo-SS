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
| M11 | Borrowing and repayment | Account-scoped indexed debt shares, per-second interest, protocol reserves, debt cap, utilization ceiling, mandatory on-chain risk-controller query, payer-signed repayments, keeper and solvency checks | Built on `main`; **32/32** combined M10/M11 Soroban tests and official CLI WASM build passed. Default borrowing paused/cap zero; no deployed M5/M7 canonical risk controller or signed Testnet loan/repayment |
| M12 | Perpetual clearinghouse | Testnet-locked isolated escrow, two-wallet signed long/short open and close, fresh oracle mark/index/deviation, mandatory external risk-authority approval, 25% initial margin, stored positions and zero-sum PnL | **16/16** native Soroban tests and official CLI **16,536-byte WASM** passed; no approved on-chain oracle/risk, no unified M6/M7 collateral, no real Testnet signed positions; M13 funding/M14 liquidation outstanding |
| M13 | Funding and settlement | Fresh authenticated oracle mark/index, bilateral funding bounded to 8h, no synthetic historical catch-up, fee schedule and separate protocol reserves, realized PnL plus funding, on-chain cash/claims/fees reconciliation | **27/27 M12–M13 Soroban tests**, **92/92 native tests**, official CLI **24,580-byte WASM** and **7/7 CI jobs passed**; not deployed, oracle/risk unaudited, no real Testnet funding or positions; M14 unilateral recovery/liquidation pending |
| M14 | Liquidations and insurance | Fresh oracle maintenance checks, signed independent keeper, ≤50% partial liquidation or fully covered close, prefunded insurance, separate protocol fees/user claims, replay and bad-debt shortfall protection | **39/39 M12–M14 Soroban tests**, **104/104 native tests**, official CLI **36,911-byte WASM**, **7/7 CI jobs passed**. Not deployed or audited; no real Testnet liquidations, approved risk/oracle, authenticated funding history or public fund safety |

## Phase 4 — Unified-margin experience

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M15 | Cross-product collateral | Canonical single-asset Testnet ledger, per-owner available/reserved balances, unique spot/perp/lending reservations, external on-chain risk authority, two-party adapter authorisation, zero-mint internal settlement | **17/17 M15 Soroban tests**, **121/121 total native tests**, **15,960-byte optimized WASM** and **7/7 CI jobs passed**. Foundation only: no deployed Hoxo contracts, approved M7 authority or actual M9/M11/M12 adapter integration; no multi-asset or live unified-margin trading. |
| M16 | Portfolio-wide risk analytics | Combined collateral/debt/perps/orders preview, health factor, adversarial stress, first-unsafe liquidation mark, leverage/concentration and exposure caps, fail-closed inputs | **11/11 M16 math**, **5/5 M7–M16 Soroban preview**, **135/135 native tests**, official CLI **25,434-byte WASM**, **7/7 CI jobs passed**. Only caller-supplied previews; no live canonical oracle/collateral/debt connectors, Testnet deployment or trading authorization. |
| M17 | Advanced order controls | Market/limit, reduce-only, TP/SL, conditional orders and auditable order transitions | **Built on `main`: 14/14 M17 signed advanced-order tests, 15/15 M8 matcher tests, 105/105 JavaScript, 8/8 Chromium, 135/135 native Rust/Soroban; 7/7 CI jobs passed**. Price-protected market IOC, conditional stop/take-profit limit/IOC, simulated reduce-only positions, signed *sandbox-only* ticks and hash-chained order history integrated. **No M5 canonical oracle, real position authority or on-chain trading.** |
| M18 | Portfolio and history | Authenticated positions, PnL, funding, interest, transfers, order and trade history | **Read-only foundation built on `main` and verified: 19/19 M18 tests, 124/124 JavaScript, 9/9 Chromium, 135/135 native Rust/Soroban and 7/7 CI jobs passed.** Public Testnet Horizon wallet transfers (without invented operation ledgers), local signed M8/M17 journal history, simulated perp exposure and terminal Transfers tab. **Live Hoxo positions, realized PnL, funding, lending interest and settled trades remain unavailable** pending verified contract deployments, authoritative ledger indexer and wallet-controlled Testnet receipts. |

## Phase 5 — Operational testnet and release

| ID | Milestone | Acceptance gate | Status |
| --- | --- | --- | --- |
| M19 | APIs and indexer | REST/WebSocket, replay/reorg reconciliation, durable logs, real market feeds | **Read-only candidate-observation foundation built on `main`: 20/20 dedicated indexer tests, 144/144 JavaScript tests, 135/135 prior Rust/Soroban tests, pinned WASM builds, ledger-hash and retention/reset fail-closed checks, durable fsynced hash chain, read-only REST + SSE checkpoint stream.** **Incomplete for live exchange**: all Hoxo contract IDs null; no independently verified events, operational WebSockets, decoded portfolio/PnL/funding, audit, backfill beyond RPC retention or real market feeds. |
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
