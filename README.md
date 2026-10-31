# Hoxo-SS

**Stellar-native spot, perpetual futures and money markets — one unified margin account.**

Hoxo-SS is a proposed non-custodial exchange for Stellar. The intended product combines:
- **Spot:** on-chain asset swaps and/or limit-order execution with settled token balances.
- **Perpetual futures:** USDC-settled synthetic exposures, funding, mark-price margin checks and liquidations.
- **Money markets:** supply, redeem, borrow and repay with risk-controlled collateral usage.
- **Unified margin:** a single collateral ledger and conservative account-wide risk calculation.

**Status: early development.** M4 read-only Stellar Testnet RPC + Horizon infrastructure is verified in CI; M5 provides read-only market-data adapters; M6–M9 Soroban source passes native contract tests; M9 builds as an optimized WASM artifact using the official Stellar CLI, but no HOXO contract is deployed. **No HOXO contracts are deployed, no wallet-controlled spot swaps or deposits have been executed, and there is no audited unified-margin risk engine.** Testnet-first. No synthetic volumes or fake live market data.

[M1–M8 audited implementation and blockers](docs/m1-m8-audit.md) · `npm run check:readiness` verifies no premature real-trading claims.

## Technical direction

Stellar smart contracts (Rust `soroban-sdk`) for vaults, settlement and enforcement; deterministic fixed-point shared risk math; oracle staleness checks; off-chain matching and indexer where necessary; wallet-signed Stellar transactions. A single risk-accounting specification must govern spot, perps and lending, and state-changing actions must be enforced **on-chain**, never merely by frontend checks.

## Product experience

- [Landing page](index.html): Nado-inspired original visual identity for HOXO SS.
- [Stellar Testnet trading terminal](app/index.html): responsive market workspace, Freighter-approved wallet identity, Testnet-only Horizon account balances and explicit not-deployed states for trading and lending.
- [M3 wallet verification and manual acceptance plan](docs/m3-wallet.md): strict Testnet validation, wallet-session lifecycle, guarded Friendbot and real-extension test criteria.
- [M4 Testnet infrastructure](docs/m4-infrastructure.md): verified Horizon + Stellar RPC, configurable HTTPS endpoints, read-only diagnostic terminal and undeployed contract registry.
- [M5 Testnet market-data adapters](docs/m5-market-data.md): live independent SDEX network observations, canonical issuer-pair parser, fixed-point OHLC and fail-closed, non-executable oracle review.
- [M6 Soroban collateral vault](docs/m6-vault.md): token allowlist, owner-signed deposits/withdrawals and isolated wallet balances. Requires Rust compilation, contract deployment and real Testnet tests.
- [M7 Risk-preview contract](docs/m7-risk.md): deterministic Rust portfolio risk and read-only Soroban previews; execution authorization remains hard-disabled pending authenticated state.
- [M8 Sandbox Matching Engine](docs/m8-matching.md): signed off-chain testnet-domain order intents, price/time matching, self-trade prevention, cancellation and deterministic restart replay. **No orders are settled or risk-authorised.**
- [M9 Soroban bilateral spot settlement](docs/m9-spot-settlement.md): two-wallet atomic token DvP, Testnet-only network ID, maker/taker limit checks, ledger expiry, receipt/replay protection and M8 non-executable proposal handoff. **No live deployment or signed on-chain settlement yet.**
- [M9 two-wallet Testnet operator](docs/m9-wallet-operator.md): official Stellar SDK RPC preflight, exact agreement and amount validation, separate non-invoker authorisation signing, explicit opt-in broadcast and receipt reconciliation. **Simulation-only until genuine deployment and two signed Testnet wallets.**
- [M10 Soroban money-market supply](docs/m10-money-market.md): isolated single-token Testnet pool, owner-signed deposits, shares and exact withdrawals, reserve checks and hypothetical interest curve. **Borrowing and live deposits disabled pending verified deployment.**
- [M11 Borrowing, repayment and indexed interest](docs/m11-borrowing.md): on-chain per-borrower debt shares, indexed interest and reserve accounting, borrowing caps/utilisation, repay-for, mandatory external canonical risk-authority call and limited keeper catch-up. **Default borrow PAUSED with zero debt cap and no trusted controller; no live lending.**
- [M12 Bilateral perpetual clearinghouse](docs/m12-perp-clearinghouse.md): single-market isolated Soroban testnet margin escrow, two-wallet long/short position reservation, mark-index freshness checks, risk authority approval and zero-sum close PnL. **No live risk/oracle deployments, unified margin, funding, liquidation or verified Testnet positions.**
- [M13 Perpetual funding, fee and reconciliation](docs/m13-funding-settlement.md): bounded mark/index-based escrow funding, fee reserves segregated from wallet claims, bilateral close accounting, on-chain reconciliation and stale-funding fail-closed behaviour. **No approved oracle or live position settlement.**
- [M14 Liquidation, insurance and bad-debt protection](docs/m14-liquidation-insurance.md): keeper-authorized isolated maintenance liquidation, prefunded insolvency reserve, partial risk reduction, precise insurance shortfall preview and zero-sum accounting. Not deployed or audited.
- [M15 Canonical margin ledger and cross-product reservations](docs/m15-unified-margin.md): single-asset Soroban vault with shared spot/perp/lending **reservations**, owner + adapter signatures, external risk authority, zero-mint internal settlement, pause-safe withdrawals, replay and solvency controls. **Foundation only: existing product contracts still use separate custody and are not wired to this ledger.**
- [M16 Portfolio-wide risk analytics](docs/m16-portfolio-risk.md): no-std fixed-point, multi-product debt/perp/collateral/orders analysis, adverse stress scenarios, first unsafe liquidation price by market, concentration/leverage caps, and Soroban **read-only** risk previews. **Prices/positions are caller-supplied; canonical on-chain exposure authorization remains disabled.**
- [M17 Advanced orders and audited sandbox transitions](docs/m17-advanced-orders.md): signed domain-separated M17 limit, market (protected IOC), reduce-only, stop-loss, take-profit and conditional limit orders integrated into M8 price/time matcher and hash-chained replay journal. Signed **sandbox-operator** price ticks only; per-account exposure is simulated, **never on-chain**. No real trading or wallet spending permitted.
- [M18 Wallet transfers and separated portfolio/order history](docs/m18-portfolio-history.md): verified-network Horizon payment observations in the Freighter Transfers tab; signed/hardened M8–M17 sandbox order and simulated trade history via read-only endpoints. No real HOXO positions, PnL, funding, lending interest or settled trade receipts; those fields explicitly remain unavailable.
- [M19 Read-only RPC event indexer, durable checkpoints and APIs](docs/m19-api-indexer.md): explicitly gated candidate-only Stellar Testnet contract-event observation with hash-anchored ledger checkpoints, replay/retention/reset HALT, append-only fsynced journal and REST/SSE read-only diagnostics. **No Hoxo contracts are independently verified or deployed, so the indexer normally remains disabled and does not report real financial history.**
- [M20 security and process-local pause controls](docs/m20-security-controls.md): sandbox/oracle/indexer default-deny gates, bounded HTTP request limits, remote operator-route denial, abuse tests and a threat-model runbook. **Only for non-executable Testnet APIs; no approved on-chain oracle, guardian or audit.**
- [M21 real-wallet end-to-end Testnet verification gates](docs/m21-testnet-verification.md): read-only receipt and signed-envelope verification for an ordered 11-step lifecycle across four independent wallet roles. No secrets, signing or broadcasts in CI; **all Hoxo contracts still planned/null, no genuine Hoxo transaction receipts or canonical cross-product state have been verified.**
- [M22 audit readiness, deterministic fuzzing and chaos testing](docs/m22-audit-chaos.md): seeded Rust/JS economic stress tests, disk/RPC/fork failures, oracle pause drills and explicit **BLOCKED** release gate with critical/high open findings. **No independent audit or on-chain transaction/contract safety claim.**
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
npm run test:spot-preview  # Non-executable M8→M9 settlement proposal tests
npm run test:m9-wallet     # M9 bilateral SDK/RPC signature orchestrator tests
npm run m9:preflight       # Operator-only Testnet simulation; explicit opt-in required to send
npm run dev:matching      # Local sandbox API on 127.0.0.1:8788 (NO exchange execution)
```

The live check requires internet access and **does not** prove deployed exchange contracts.

The JS reference engine is **not smart-contract authorization** and must not be used to safeguard funds on its own.

## Security
Do not fund unreviewed contracts. No admin or private keys in this repo. Avoid unauthenticated oracle writes and off-chain-only enforcement.
**M10 build evidence:** [7/7 CI jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41195457096), including 16/16 Soroban money-market tests and [the review-only M10 WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41195457096/artifacts/13040750629). No mainnet or Testnet asset-deposit activation is implied.

**M11 verification:** [7/7 CI jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197119204), including 32/32 Soroban money-market tests and [the 27,471-byte review-only WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197119204/artifacts/13041143590). Live on-chain lending is **not** enabled; an audited M5/M7 canonical risk authority and verified independent Testnet transactions remain required.

**M12 verification:** [All 7 CI jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197638913): 16/16 M12 contract tests, 81/81 total native Rust/Soroban tests, 91/91 JS and 8/8 Chromium. [Review-only compiled M12 WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197638913/artifacts/13040608388), 16,536 bytes. This is **not deployed** and contains no live Stellar Testnet positions or audited oracle/risk authority.

**M13 verification:** [All 7 GitHub Actions jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41198308476), including 27/27 clearinghouse tests, 92/92 total native tests, 91/91 JavaScript tests and 8/8 Chromium tests. [Optimized M12–M13 WASM artifact (24,580 bytes)](https://github.com/mushee-io/Hoxo-SS/actions/runs/41198308476/artifacts/13041482002). These are **build-only results**, not deployed contracts, live funding or user funds.

**M14 verification:** [7/7 GitHub Actions jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41199287473); 39/39 isolated clearinghouse tests, 104/104 native Rust/Soroban tests, 91/91 JavaScript and 8/8 Chromium. [M12–M14 compiled WASM artifact (36,911 bytes)](https://github.com/mushee-io/Hoxo-SS/actions/runs/41199287473/artifacts/13042086517). This is *not* a deployed Testnet clearinghouse, insurance reserve, or real liquidation proof.

**M15 verification:** [7/7 GitHub Actions jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41201917116), with 17/17 canonical margin contract tests, 121/121 total Rust/Soroban tests, 91/91 JavaScript and 8/8 Chromium. [Review-only 15,960-byte M15 Soroban WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41201917116/artifacts/13042892690). **The code is not deployed or connected to M9/M11/M12**, so operational cross-product unified margin remains blocked.

**M16 verification:** [7/7 GitHub Actions jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41217789563), including 11 new analytics math tests, 5 risk-gate Soroban tests, 135/135 total native tests, 91/91 JavaScript and 8/8 Chromium. [Review-only 25,434-byte risk analytics WASM](https://github.com/mushee-io/Hoxo-SS/actions/runs/41217789563/artifacts/13048966081). **Read-only preview**, not authenticated live financial risk or permission to trade.

**M17 verification:** [7/7 CI jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41219081680), including **14/14** M17 tests, **15/15** original M8 matching tests, **105/105** JavaScript, **8/8** Chromium and **135/135** native Rust/Soroban tests. No new M17 WASM is produced because M17 extends the *off-chain sandbox matcher*. The Hoxo exchange remains `NOT_LIVE`; all trades and positions here are simulated, with no approved on-chain oracle or spend authorization.

**M18 verification:** [7/7 GitHub Actions jobs passed](https://github.com/mushee-io/Hoxo-SS/actions/runs/41223324644), including 19/19 history tests, 124/124 JavaScript, 9/9 Chromium and 135/135 Rust/Soroban. The Freighter Transfers tab reads public Horizon Testnet payment observations; signed M8/M17 journal portfolio endpoints are **sandbox-only**, not authenticated exchange positions. Real Hoxo PnL, accrued interest, funding and settled trades are unavailable because the exchange contracts and indexing adapters have not been deployed.

**M19 verification:** [GitHub Actions source/test run](https://github.com/mushee-io/Hoxo-SS/actions/runs/41224344199) includes 20/20 M19 RPC/indexer tests, 144/144 total JS and 135/135 unchanged Rust/Soroban tests. Default indexer status is **DISABLED_NO_VERIFIED_DEPLOYMENTS**, with **no event ingestion** because real Hoxo contract deployments have not been verified. REST/SSE is read-only; WebSocket service, full financial decoding and live Hoxo market feeds remain outstanding.
