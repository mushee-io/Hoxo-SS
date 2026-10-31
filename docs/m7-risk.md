# M7 — risk math and Soroban risk preview (FAIL CLOSED)

The Rust workspace adds `hoxo-risk-math`, a deterministic no-std fixed-point module, and `hoxo-risk-gate`, a Soroban contract that evaluates caller-supplied account snapshots. **It is not yet an authenticated on-chain unified-margin validator.**

Capabilities: 7-decimal checked integer math, collateral factors, accrued debt, long/short unrealised PnL, funding liabilities, margin reservations, initial/maintenance thresholds, margin health and hypothetical withdrawals. Duplicate market/asset IDs, stale/future timestamps, bad signs and numeric overflows are rejected.

Safeguards: The Soroban contract obtains time from the ledger, returns `execution_permitted:false` in every preview and its `authorize_trade` and `authorize_withdrawal` methods **always return NotIntegrated**. A caller may provide arbitrary collateral, debt or price values, so this preview must never be used as trade approval or authoritative collateral.

Tests:
```sh
cargo test -p hoxo-risk-math --all-targets
cargo test -p hoxo-risk-gate --lib
```

What is needed for full M7:
1. M6 Testnet vault deployed and backed by genuinely signed deposits and account-specific token records.
2. M5 audited on-chain oracle adapter that enforces authenticity, heartbeat, drift and price caps (independent public SDEX orders are not an approved oracle).
3. Atomically fetched canonical debt positions, perp positions and order reservations rather than caller-supplied snapshots.
4. In-contract risk validation on *every* borrow, withdrawal, trade and liquidation mutation, with stale-price fail-closed behaviour and rigorous rounding invariants.
5. Reserve-release, rollback, transaction finality and independent wallet testnet audits; contract ID/tx evidence before enabling UI actions.
6. Protocol 30 Testnet migration checks (vote scheduled for November 3, 2026).

Until these exist, M7 is **preview functionality only** and M8's matching engine must not enable settlement, credit or actual leveraged trading.
