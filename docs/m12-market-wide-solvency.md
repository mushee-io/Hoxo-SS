# M12 — bounded market-wide position and liquidation solvency checks

**Status: source code + native Soroban tests only. No public Stellar Testnet financial transaction, trusted deployment evidence, third-party audit or financial beta approval.** This is a current-oracle mark-to-market review snapshot, NOT a promise that the clearinghouse can liquidate every position under future stressed volatility, keeper delays or slippage.

## The fundamental change

Previously, M12 tracked each account's active positions but could not exhaustively answer **which positions exist across the whole market**. Summing one wallet's collateral or examining one potential liquidation could therefore understate total insurance needs.

Now M12 also owns an on-chain **global active-position registry** `MarketPositions`. Constructor creates it empty. Every bilateral `open` registers the unique 32-byte ID; authenticated `close` or completed **full** M14 liquidation deletes it; partial M14 liquidation retains it with updated reduced base and escrow. Every operation has atomic Soroban rollback semantics, so a failed preflight cannot leave a ghost index or duplicate wallet claim.

The market maximum is reduced to **64 simultaneous matched positions**, and the prior **32 active positions per wallet** limit remains. These are conservative source review bounds, not throughput goals or assurances that worst-case 64-position transactions meet public-network resource limits. Independent RPC simulation and stress/fee profiling remain required before opening real positions.

## `PerpClearinghouse.market_exposure()`

The source method independently reads the exact global index, all referenced active `Position` entries and the source's actual owner index+wallet locked balances. It verifies:

1. Total indexed IDs exactly equals the actual stored `Totals.open_positions` count and each entry is unique and belongs to exactly two distinct, registered counterparties.
2. Both counterparties independently index the ID **exactly once**. Each distinct wallet's actual `locked_e7` equals the sum of that user's position margins from the global registry, and per-owner index counts equal observed positions.
3. Every marked position uses M12's exact configured oracle, passing mark/index deviation and the **120-second maximum price age**. Pending M13 funding calculations reject >8-hour accumulation gaps rather than reconstructing a fictional historical path.
4. Each matched contract contributes an actual signed long and short mark-to-market exposure. Their paired PnL and funding are equal/opposite, **but unrealised PnL is never moved into spendable M15/M12 balance**.
5. Maintenance deficits and **negative-equity insurance requirements are aggregated across *every* open position**. This prevents a $10 reserve being presented as sufficient when there are two simultaneous $6 bankrupt positions. A gross insurance shortfall is explicitly exposed, and the snapshot's `insurance_snapshot_covered` becomes false.
6. The actual M12 token balance is compared to all current-book owner claims, protocol fees and prefunded insurance reserves. A shortage fails the `token_book_backed` flag without silently minting claims or altering custody.

A source-level method `market_position_ids()` exposes the bounded global list and requires it to agree with the official open-position count.

## Cross-product risk authority

`PortfolioAccounting.snapshot(owner)` calls `PerpClearinghouse.market_exposure()` and cross-checks the returned timestamp, market ID, active count, pre-existing reconciliation cash, and insurance. It now reports the real global locked margin, aggregate maintenance deficit, gross insolvency, insurance shortfall and whether the global index reconciles.

**Important:** `full_perp_exposure_enumerated:true` means the bounded **current market position set is complete and internally reconciled**, not that every position has a permission to liquidate or the insurance pool can cover a violent price move. The separate `m12_insurance_snapshot_ok` and `m12_insurance_shortfall_e7` fields expose stressed deficits **at the observed mark**; they do not predict losses at future prices.

The existing M15 two-stage spot preflight now also requires the full global index, zero insurance shortfall, actual token-backed claims and **zero open loans / zero open perpetual positions**. Consumption-time M11 debt and M12 position checks still prevent a new liability appearing between permit preparation and execution, and avoid forbidden M15 contract re-entry.

Production M11 `approve_borrow`, M12 `approve_open`, `PortfolioAccounting.unified_leverage_authorized`, `MarketExposure.system_risk_approved` and `financial_beta_approved` **all remain false**. This does not activate shared leverage, spend user funds or license mainnet execution.

## Explicit limitations

- M12 uses a single fresh oracle **mark and index**, not a multi-venue independent price audit, liquidity depth guarantee, liquidation fill simulation or dynamic stress VAR.
- Aggregate insurance sufficiency is a **point-in-time gross negative-equity estimate**. M14's actual keeper-driven liquidation and accounting, funding catch-up, partial reductions, reward and insurance payouts require separate independent audit and public Testnet acceptance.
- The global index is accurate only if all on-chain state transitions and any future migration preserve it. Old deployed code could require a reviewed migration; nothing in this source proves provenance of older state.
- Soroban metering, TTL rent, long-dormant position expiry, account lifecycle, protocol limits and worst-case per-owner DoS require independent review before any live deployment.
- Separate M11 loan debt and M12 perpetual exposure still cannot borrow against the same live M15 collateral through a canonical *executable* multi-product liquidation engine. The custody router only migrates real token claims between isolated vaults when debt and positions are zero.
- Read-only Testnet RPC/Horizon CI checks are **not operator-signed Hoxo financial transactions**. Native tests use mock auth and offline Soroban sandboxes.

## Verification and release gates

```sh
cargo test -p hoxo-perp-clearinghouse --lib
cargo test -p hoxo-portfolio-accounting --lib
cargo test -p hoxo-canonical-risk --lib
stellar contract build --package hoxo-perp-clearinghouse
stellar contract build --package hoxo-portfolio-accounting
npm run check:readiness
npm run m21:readiness
npm run m22:readiness
npm run m23:readiness
npm run m24:readiness
```

The new tests include: aggregate two-pair positions, exact wallet locks, zero-sum unrealised PnL, pending funding and >8-hour stale rejection, two independent bankrupt positions requiring combined insurance, partial insurance top-up, full liquidation removal, and multi-owner cross-product token/claim conservation.

**Still to do:** audited executable cross-product borrow/perp margin and liquidation logic, worst-case position-count metering and TTL safety, secure operator and public Stellar Testnet signed transaction evidence, external code/economic audit, third-party compliance and governance approvals. Public financial beta CLOSED; mainnet NO-GO.
