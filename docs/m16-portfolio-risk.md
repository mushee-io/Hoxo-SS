# M16 — Portfolio-Wide Risk Analytics (Read-Only)

**Status:** Pure Rust arithmetic and Soroban read-only preview contract code. M16 does **not** implement authentic on-chain portfolio reads, risk authorization, user custody or automated liquidation. All Hoxo contracts still have null deployment IDs on Stellar Testnet.

## Implemented

The existing M7 `hoxo-risk-math` library now contains `src/m16.rs`, and the existing M7 `hoxo-risk-gate` exposes `preview_analytics` and `preview_liquidation`. The two use the **same M7 baseline evaluator** for multi-asset collateral, lending debt **including interest**, up to 16 perpetual markets, and order initial/maintenance reservations (max 16 entries per category).

### Portfolio health and stress

`preview_analytics(collateral,debt,perps,orders,funding,caps,shock)` reports a baseline and stressed risk view with:
- Gross and haircut-adjusted collateral, total indexed debt, gross perp notional and unrealized PnL, signed pending funding, initial/maintenance margin, equity, available margin, maintenance-based health in basis points and health classification.
- Caller-specified but **bounded** shocks: collateral price reduction (0–8,000bps), debt price increase (0–20,000bps), adverse long/short perp mark moves (0–8,000bps) and extra funding loss. Long marks are lowered; short marks are raised; debt prices round up; collateral rounds down; baseline oracle timestamps must already be fresh.
- Six risk-cap breach flags, from one deterministic policy: per-market gross notional, total perp gross notional, total lending debt, total initial order reservations, portfolio gross-notional / equity leverage and largest collateral asset concentration. **No netting of opposite positions across unique markets** is counted as free collateral.

If the baseline or stress scenario violates margin, or any configured exposure cap is exceeded, the response sets `reduce_only_recommended=true`. **This is advisory and does not execute, cancel, liquidate or authorize a position.** The policy and scenario values are provided by the caller and are not controlled by governance.

### Hypothetical liquidation price

`preview_liquidation(...,marketId)` checks a fresh, structurally valid supplied portfolio, selects one market and finds the **first unsafe 7-decimal mark tick** in the adverse direction, using checked binary search and the *same* maintenance-margin evaluator. Other positions, collateral, debt, oracle values and funding remain constant. If the account is already liquidatable it returns the current mark. If no bounded unsafe threshold is found, the estimate is absent rather than asserting that liquidation cannot happen. Estimates ignore slippage, changing collateral prices, funding history, market liquidity and actual M14 keeper execution. **They are not execution triggers or guaranteed liquidation prices.**

### Fail-closed protections

All values are checked signed integer 10^7 units, with conservative ceiling/floor rounding and overflow rejection. The engine rejects duplicate/non-positive IDs, invalid amounts, out-of-policy shocks/caps, malformed risk parameters and stale/future prices. No parameter path changes `authorization_enabled() -> false`, `authorize_trade`, or `authorize_withdrawal`; all preview results explicitly report `execution_permitted=false`. Empty no-liability portfolios report `health_bps=None` rather than inventing an infinite number or declaring creditworthiness.

## Verifying the code

```sh
cargo test -p hoxo-risk-math --all-targets
cargo test -p hoxo-risk-gate --lib
stellar contract build --package hoxo-risk-gate
npm run check:readiness
```

Native Rust tests cover multi-product calculations, positive/negative perp shocks, all exposure cap flags, invalid or stale snapshots, long and short liquidation-price tick boundaries, already-liquidatable accounts, exact integer rounding and overflow. Soroban tests verify the public read-only methods and the still-disabled execution gates.

## Not yet operational

1. **Canonical data feeds:** M5 real on-chain market oracle, M11 real debt positions, M12–M14 positions and M15 canonical collateral/reservations are not connected to this analyzer. A client can supply fictitious numbers, so previews do not establish safe, live net risk.
2. **Risk-authority contract:** M7 still always rejects execution. M15 cannot unpause with M7 as its controller. Real atomic authorization needs approved Soroban cross-contract readers, protection against same-ledger state changes and appropriately scoped wallet allowances.
3. **Liquidation enforcement:** M14 still requires a live authorised mark/index feed, signed keeper, independent insurance funding and historical funding recovery. M16 price estimates do not make M14 safe.
4. **Deployment/audit:** no verified Testnet deployment, independently signed portfolio test, upstream-asset issuers, external security audit, oracle/economic review or production stress policy exists.

**M16 is buildable risk analytics only; live trading, unified-margin borrowing, deposits and liquidation remain disabled.**

## Build verification — 31 October 2026

[GitHub Actions run 41217789563](https://github.com/mushee-io/Hoxo-SS/actions/runs/41217789563) passed **all seven jobs** at the verified M16 code commit:

- **11/11 M16 pure-math tests** and **14/14 existing M7 math tests**.
- **5/5 Soroban M7–M16 read-only risk preview tests**.
- **135/135 total Rust/Soroban tests** across risk, vault, spot settlement, lending, perpetual clearing, and unified-margin reservations.
- **91/91 JavaScript** and **8/8 Chromium browser tests**, plus independent live **read-only** Stellar Testnet RPC and Horizon connectivity checks.
- Official **Stellar CLI v28.1.0** `stellar contract build --package hoxo-risk-gate` compiled and optimized **25,434 bytes** of Soroban WASM, SHA-256 `5f58b1626574b681091d1cb15c27a628ebc92bedac9173bd0dbad24cc3234538`.
- [Compiled M16 risk-analytics WASM review artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41217789563/artifacts/13048966081), subject to GitHub retention.

**This verifies source and compilation, not a genuine credit/risk authority or live account balance.** There are no Hoxo contract addresses or ledger transaction receipts registered. The execution permit remains hard-disabled, and no independent audit has established price feed or protocol security.
