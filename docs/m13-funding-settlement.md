# M13 — Perpetual funding, settlement fees and reconciliation

**Scope:** Extends the existing M12 **isolated**, single-market Soroban perpetual clearinghouse on Stellar Testnet. This is source code for deterministic accounting and contract tests, **not deployed financial infrastructure**. No approved M5 oracle or canonical M7 risk authority exists, and no real Hoxo margin has been deposited.

## 1. Separation of index, mark and funding

The contract continues to read `mark_e7`, `index_e7` and `updated_at_sec` only from the configured external **Soroban oracle**. The oracle must be independently reviewed and registered as actually deployed. Mark and index must be positive, non-future, no older than 120 seconds and diverge by at most 200 basis points. Caller-supplied JavaScript prices cannot create a funding payment.

M13 adds a **bounded illustrative premium funding rule**, not an audited exchange funding mechanism:

```
fundingPaidLongToShort =
  quantity * (mark - index) * elapsedSeconds
  / (10^7 * 28,800)
```

All arithmetic is checked signed `i128`, producing exact collateral-token minimal units. Positive results mean long pays short; negative results mean short pays long. This is a simplified model that would pay approximately the contemporaneous mark-index premium over eight hours. It is **not** a volume-weighted TWAP, independent funding benchmark, or historical oracle backfill.

Each position records `last_funding_sec`, its own long/short locked margin and cumulative signed funding. The permissionless `settle_funding(id)` computes a transfer **only between those two escrows**; it never mints tokens or debits an unrelated account. The contract refuses a transfer that would violate the 15% illustrative maintenance-equity threshold (including unrealized mark PnL). Negative or stale timestamps, price divergence, and a time gap exceeding eight hours all **fail closed**.

The `close(id)` method automatically applies funding for any still-current interval **in the same atomic Soroban invocation** before calculating final realised price PnL. Both parties must still authorise the close. If the interval is older than eight hours, closing fails rather than retroactively applying the latest price to historical hours. This is an intentional safety restriction: until a separately authenticated historical funding feed and **M14 keeper/unilateral recovery** are implemented, dormant or uncooperative positions can become stuck. **Never fund a public position under that limitation.**

## 2. Trading fees and on-chain reconciliation

The clearinghouse starts with **0bps** opening and closing fees. The authorised admin may set fees only while the contract is paused and there are zero open positions, bounded between 0–10bps per side per operation. A fee change cannot affect an already open position. All fees are calculated using conservative rounding in the same 7-decimal collateral-token units.

- At open, both wallets authorise the position, post initial isolated margin, and any separately computed fee is deducted from each wallet's **free balance**, credited to the contract's **protocol fee ledger**, and subtracted from aggregate user claims.
- At close, realised gross long and short payouts are calculated using **their current funded escrows**, not the unchanged original margin. The contract charges each side at most its available payout (never creates a negative fee debt), credits net proceeds, reduces total user claims by collected fees and records the cumulative fee amount and price PnL in the persistent closed position.
- The `reconciliation()` endpoint returns actual Soroban token holdings, aggregate user claims, tracked accrued protocol fees, unsolicited-token surplus and the count of open positions. Its solvency condition is **actual assets >= user claims + protocol fees**.
- Unsolicited token transfers do **not** silently become earned user margin or protocol fees. There is **no admin sweep or fee-withdrawal endpoint** in M13. The fee ledger is held strictly separate pending audited treasury rules.

## 3. User and operator restrictions

Opening still requires **both parties' signatures**, a fresh oracle mark/index, a separately configured Soroban risk-controller decision on each side, 25% isolated initial margin and checked price limits. Closing requires **both parties' signatures**, fresh oracle values and sufficient locked collateral. If price PnL exceeds the loser's escrow, settlement is refused rather than minting unbacked equity. Withdrawals remain limited to a user's free margin. Administrative pauses prevent new positions without stopping already-authorised closes (subject to funding/oracle restrictions).

All positions and fee balances remain isolated to this contract. There is no M6 vault integration, money-market borrow/repay, cross-product offsets, liquidations, insurance, open-interest TWAP, historical oracle proof or independent keeper.

## 4. Verification

```sh
cargo test -p hoxo-perp-clearinghouse --lib
stellar contract build --package hoxo-perp-clearinghouse
npm run check:readiness
```

Native tests use **mock oracle and risk controllers** and prove only contract behaviour in Soroban's native test environment. They cover flat and profitable closes, funding between escrows, both funding directions, fee reserve segregation, changing fee governance, malformed/stale oracle values, eight-hour cutoffs, maintenance failures, replay, unauthorized wallet calls, unilateral funding and external token donation accounting.

## 5. Missing release gates

1. **M5:** independently reviewed on-chain price source capable of authenticating mark, index, heartbeat, price limits and historical funding settlements.
2. **M7:** deployed risk authority using canonical on-chain collateral, orders, debt, positions and price data; not a caller-provided portfolio preview.
3. **M12:** real Testnet escrow deployment, reviewed valueless quote asset, signing wallet operator workflows, completed deposit/open/close/withdraw transaction receipts and independently reconciled balances.
4. **M13:** economic review of funding mechanism, rounding/bad-debt invariants, TWAP/oracle manipulation resistance, event indexing, settlement-ledger reconciliation and fee governance.
5. **M14:** safe unilateral close/liquidation/insurance and gap recovery for undercollateralized, stale or uncooperative positions. The current two-signature and eight-hour cutoff model **is not safe for public funds**.
6. **M15:** canonical shared margin with M6/M11/M9. M12/M13 remain isolated.

**The contract compiles/tests only. Do not claim live positions, funding, trading volume, realised earnings, contract deployment or approved liquidity.**

## Verified build and test evidence — 31 October 2026

[GitHub Actions run 41198308476](https://github.com/mushee-io/Hoxo-SS/actions/runs/41198308476) passed **all 7 jobs**, including the native Soroban M12–M13 test suite (**27/27**) and official Stellar CLI build:

- Existing native Rust/Soroban tests: risk mathematics 14/14, collateral vault 5/5, risk preview 2/2, spot settlement 12/12, money market 32/32. Combined across crates: **92/92**.
- JavaScript **91/91**, Chromium **8/8**, M8 and M9 SDK checks green.
- Real **read-only** Horizon/RPC Stellar Testnet checks passed; **no Hoxo contract or funded trade was deployed or verified**.
- Official CLI v28.1.0 `stellar contract build --package hoxo-perp-clearinghouse` produced **24,580 bytes** of optimized M12–M13 WASM.
- WASM SHA-256: `562d027437f0fbc4cddf380244b04e9e15b82294851db971729e979b40a250c1`.
- [Review-only compiled M12–M13 WASM artifact](https://github.com/mushee-io/Hoxo-SS/actions/runs/41198308476/artifacts/13041482002), available for GitHub's configured artifact retention period.

**Final acceptance distinction:** GitHub CI proves source test behavior and a valid WASM build, not authenticated live on-chain oracle updates, wallet-signature acceptance, funding receipts, actual fee income, safe liquidation or cross-margin trading. Every Hoxo exchange contract remains `planned` with `contractId:null` in the Testnet registry.
