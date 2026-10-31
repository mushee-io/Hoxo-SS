# Milestone 10 — Soroban money-market supply pool

**Build target:** Stellar Testnet, patched Soroban SDK 29.0.1. Single-asset, isolated vault / share registry. No borrow, repayments, lending yield, cross-margin, or third-party asset settlement is operational.

## Implemented

- `contracts/money-market`: Rust Soroban contract for a 7-decimal token selected in the constructor and an owner-approved admin. A hard-coded Testnet network ID is checked at construction and on state-mutating user funds operations.
- **Deposits begin paused.** Admin explicitly unpauses new supply, enforces a configurable nonzero supply cap, and can transfer admin rights only with dual approval. There is no admin sweep or administrative share mint.
- `supply(owner,amount)`: owner authorization required, positive fixed-point token units, exact token received balance check, shares minted at floor(amount * totalShares / poolAssets), initial exchange rate 1:1, user-specific recorded shares, cash+shares updated atomically. A failed token transfer leaves no credited shares.
- `redeem(owner,shares)`: owner authorization required, shares verified, underlying returned according to share/asset exchange rate (floor), token transfer checked, total and user balances reduced atomically. Remains available even if new deposits are paused.
- `withdraw(owner,amount)`: exact token quantity returned, shares burned conservatively using **ceiling** division. Prevents an exact-amount withdrawal that burns the final shares but leaves unowned recorded liquidity.
- The contract separates **accounted cash** from **actual token balance**; unsolicited direct token transfers are not silently credited as yield. Pool solvency checks ensure real token balance covers recorded cash. There is no controller action that can extract surplus.
- `pool()` returns cash, share supply, initial indices, zero borrowed/reserves, caps, exchange rate, pause and current **zero-utilization** quote. `preview_rates(assets,borrowed,reserveFactorBps)` calculates a hypothetical utilization / kinked borrow APR / supply APR but **does not change contract debt or create accrued interest**.
- **Hypothetical interest model**: 2% base borrow APR, +8 percentage points up to 80% utilization, +70 points after 80% to 100%. Supply APR calculation includes a hypothetical reserve factor; when no real borrowers exist, actual supply APR is zero, always. Rates are engineering placeholders requiring later governance and economic review.
- `borrow_disabled()` always fails and `borrowing_enabled()` always returns false. Borrow index and supply index are fixed at 1.0 until a canonical interest/debt module is created in M11.
- `keepalive(owner)` permissionlessly renews Soroban instance/share TTL. Persistent archived share records require explicit state restoration, not zero-balance recreation; an off-chain keeper, archival recovery testing and economic limits are essential before real deposits.

## Test acceptance

Native Soroban tests cover independent accounts, supply and partial/final redemptions, exact withdrawal share burning, paused withdrawals, unauthorized wallet and admin rejection, supply caps, insufficient funds, donation accounting, wrong network, error/overflow behavior, hypothetical rate bounds, interest-index invariants and TTL keeper. GitHub Actions must pass `cargo test -p hoxo-money-market --lib` and `stellar contract build --package hoxo-money-market` and upload a review-only WASM artifact.

## Still missing (not a live lending protocol)

1. No approved money-market token contract or Hoxo M10 Testnet contract ID / deployment receipt is registered in `registry/testnet.json`. No actual funded-wallet supply/withdrawal transaction can be claimed.
2. Real operator-controlled deployment, audited single-asset security policy, two independent user-wallet supply/redeem tests, asset trust/issuer review, and permissioning are not yet performed.
3. No active borrow ledger, interest accrual, borrower collateral, on-chain M5 oracle, M7 margin enforcement, reserve funding, liquidation or unified-margin integration exists. M11 is a distinct protocol milestone.
4. Rate model is hypothetical, not actual APY or a market quote. Borrow index and supply index never increase in M10.
5. External contract/security/economic audit, token transfer-hook compatibility, archival/TTL restore keeper and live protocol upgrade review remain release blockers.

## Local verification

Run `cargo test -p hoxo-money-market --lib`; with official Stellar CLI pinned to an SDK-compatible release, run `stellar contract build --package hoxo-money-market`. These run locally without submitting any transactions.

**Safety gate:** all actual deposit, withdraw, borrow, margin and trading controls remain disabled in the public terminal until there is verifiable Stellar Testnet deployment and independent wallet receipts.

## Verified build evidence — 31 October 2026

[GitHub Actions run 41195457096](https://github.com/mushee-io/Hoxo-SS/actions/runs/41195457096) passed **all 7 jobs** against the source commit `6900f5a8f1cfddce0a71da38152e503c18f600c3`:

- M10 native Soroban supply-only tests **16/16 passing**
- Existing Rust math 14/14, collateral vault 5/5, risk preview 2/2, spot settlement 12/12
- JavaScript 91/91; Chromium 8/8; M8 and M9 SDK checks; actual read-only Stellar Testnet Horizon/RPC checks
- Official Stellar CLI v28.1.0 `stellar contract build --package hoxo-money-market` **succeeded** and optimized the WASM to **14,970 bytes**
- WASM SHA-256: `bb9c232532f3f6a477e2e8243fe43e9080670b0447cd422be2224cac9d9b96e3`
- [Review-only money-market WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41195457096/artifacts/13040750629) (GitHub artifact with limited retention).

**This is compiled/tested code, not a signed on-chain deployment.** The M10 registry entry remains `planned` with `contractId:null`. No asset yield, borrower or real user deposit was produced by these tests.
