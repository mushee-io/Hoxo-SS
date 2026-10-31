# M11 — Borrowing, indexed interest and repayment

**Scope:** Source implementation for the existing M10 Soroban money-market contract. `contracts/money-market/src/lib.rs` now shares protocol state with `contracts/money-market/src/m11.rs`. This is a code milestone, not a deployed lending market. The pool deploys exclusively to Stellar Testnet and its **borrowing is paused, debt cap zero and risk controller absent by default**.

## Implemented

**Borrower positions.** Each account has persistent debt shares, and the pool tracks the sum. Debt owed is `ceil(debtShares * borrowIndex / 10^7)`. Origination mints conservatively rounded debt shares after owner auth, reserve/liquidity/borrowing caps and a canonical on-chain risk authority query. The exchange cannot originate credit by presenting JavaScript portfolio data, a mock risk preview, or only an M8 order signature.

**Interest accrual.** The existing M10 kinked rate model (2% base, +8% to 80% utilisation, then +70% to 100%) now drives an on-chain indexed debt ledger. Accrual uses integer math, explicit time delta and carried fractional remainder to avoid zeroing interest with frequent tiny updates. A configured reserve-factor share of accrued debt increases protocol reserves; supplier exchange rate reflects net book assets, but **unrealised loans are not cash or guaranteed realised yield**. Initial `borrowIndex=1.0`, `supplyIndex=1.0`; zero borrowed balance produces no invented yield.

**Repayment.** `repay(payer, borrower, maxAmount)` requires payer auth, may repay another user's loan, burns debt shares conservatively, transfers only actual owed tokens and restores on-chain liquidity. Repayment is allowed with borrowing paused and does NOT depend on the risk controller's availability. Expired/stale interest must first be caught up; otherwise repayment fails closed rather than forgiving elapsed interest.

**Liquidity and safety.** `borrow` checks owner signature, current Testnet network ID, no stale accrual, separate borrowing pause, configured cap, an approved on-chain risk authority, all issued debt shares and utilisation <= configurable maximum (up to 90%). It transfers underlying to the borrower only after the risk controller approves **the complete projected per-borrower debt**. A risk failure reverts the whole invocation. Supplier redemptions are still constrained by actual cash; outstanding receivables cannot be instantly redeemed as if liquid.

**Operational limits.** Admin can configure exactly one risk authority, then borrower caps (up to the existing supply bound), 1–90% utilisation ceiling, reserve factor <=50%, and pause/enable state. A bad authority configuration is a catastrophic trust risk; M7's existing preview contract is **NOT** a trusted credit gate. Live integration requires an independently audited authority that reads fresh canonical oracle, portfolio, collateral, reservation and liability values itself. Until then, the default zero cap and pause must not be lifted.

**Keeper.** Interest advances in bounded periods of at most 30 days. Funds mutations reject dormancy beyond one period; permissionless repeated `accrue_interest()` calls step through longer gaps. Persistent per-borrower debt shares require TTL renewal and archived-storage restoration procedures. This is **not** an automatic keeper, liquidation engine, insurance fund or bad-debt recovery system.

## Development tests

Run `cargo test -p hoxo-money-market --lib`, `npm run check:readiness`, or CI's Rust job. The Soroban mock risk gate in tests is a **fixture only**, not Hoxo's risk approval deployment. Tests include default denial, authenticated borrow, partial/full repayment, cap and liquidity checks, risk-denial rollback, interest plus reserves, bounded catch-up, unauthorised signatures, debt/share segregation, lender liquidity and third-party repayment.

The actual compiled `wasm32v1-none` artifact is built with `stellar contract build --package hoxo-money-market` under the official CLI. A build does not transfer funds and is not proof of contract deployment.

## Still required to operate

1. Deploy independently reviewed M5 oracle, M6 custody and a new canonical M7 borrower risk controller with authenticated cross-product state. Current M7 only provides caller-input previews and **cannot approve a genuine loan safely**.
2. Audit the M10-M11 combined contract, debt rounding, accrual behaviour, signed delegated approvals, risk-controller governance, insolvency, archival recovery, rate caps and economic parameters.
3. Deploy M11 WASM to Stellar Testnet using an independently controlled wallet and approved valueless token contract; register genuine contract ID and ledger transaction hashes, then verify supply→borrow→accrue→repay→withdraw across two or more independently signed wallets.
4. Build the M14 liquidation, insurance and bad-debt recovery path; integrate cross-product margin later in M15 and do not imply existing M10 shares can be used as cross-product collateral.
5. Keep the public terminal's real custody, borrow and trading controls disabled until independent on-chain receipts and tests establish safety. Do not report theoretical supply APR as paid or earned interest.

**No real Stellar Testnet loan, repayment, contract deployment or audited risk authority is claimed by M11 source code.**

## Verified CI build — 31 October 2026

[GitHub Actions run 41197119204](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197119204) passed all **seven** jobs with full M11 source and verification:

- **32/32** combined M10/M11 native Soroban money-market contract tests, including 16 original supply tests, 13 borrowing/interest/repayment tests and three additional conservation tests.
- **91/91** JavaScript tests and **8/8** Chromium smoke tests.
- Other native Rust/Soroban tests: M0/M7 math **14/14**, M6 vault **5/5**, M7 preview **2/2**, M9 spot-settlement **12/12**.
- Live **read-only** Stellar Testnet Horizon and RPC handshake checks passed.
- Official Stellar CLI v28.1.0 `stellar contract build --package hoxo-money-market` produced a **27,471-byte optimized M10–M11 WASM**.
- WASM SHA-256: `11e469ab406cb2dc016e5dd9f825ae249280a146806dfa2712b4cac090394d13`.
- [Review-only compiled M10–M11 WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41197119204/artifacts/13041143590), subject to GitHub artifact retention.

**Deployment gate:** the on-chain risk-authority contract is STILL ABSENT, all Hoxo contract IDs in `registry/testnet.json` are null, borrowing defaults to a zero cap and paused state, and no owner-signed funded Testnet loan or repayment receipt is verified. No public money-market supply, borrow, transfer or trading buttons should be activated on the basis of these test results.
