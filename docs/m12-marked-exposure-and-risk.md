# M12 position-level exposure and M15 cross-product spot risk guards

**Status: native Soroban source, local tests and review-only WASM. Not audited, not deployed on public Stellar Testnet, and not authorised for leveraged trading.** The Hoxo financial Testnet beta remains closed; mainnet remains NO-GO.

## M12 now enumerates an owner's currently active positions

`hoxo-perp-clearinghouse` maintains a persistent, bounded **owner-to-active-position-ID index**. A successful bilateral `open` adds the exact 32-byte ID to both counterparties; authorised `close` and successful **full** liquidation remove it from both. Partial liquidation retains the ID, since residual exposure remains. The list is capped at 32 active positions per wallet, while the pre-existing total market cap remains 1,000. Over-capacity opens revert atomically before collateral becomes locked. Historical positions remain in the original immutable position records; active IDs are never reused.

`owner_position_ids(owner)` reports active IDs. `owner_exposure(owner)` checks actual current position storage and verifies each ID's owner, active state and exact total locked margin against that owner's actual M12 wallet. It uses the contract's **configured on-chain oracle** and existing M13 funding / M14 liquidation formulas, with the same price staleness and deviation checks as M12 trading. For an owner with active positions, it reports:

- Signed base (long positive, short negative), current locked margin and free M12 balance;
- Aggregated **mark-to-market unrealised PnL**, signed **pending funding** (positive means owner owes funding), marked net PnL and resulting marked equity;
- Per-position maintenance margin summed across active positions, aggregate maintenance shortfalls and gross negative-equity deficits, and whether liquidation is required;
- Timestamp, actual indexed count and completeness flags.

The method rejects missing, foreign, closed or mismatched index entries, as well as stale oracle data, >8-hour unfunded gaps, unsafe math or locked-margin discrepancies. A wallet with zero indexed positions must have zero locked collateral. It never asserts that *all users in the market* have been economically reconciled. The results are **mark estimates** until actual funding, close or liquidation; they cannot be withdrawn as spendable tokens.

## Cross-product reporting now includes the marked owner

`PortfolioAccounting.snapshot(owner)` combines genuine M15 available/reserved collateral, M11 current-ledger accrued loan debt/supplier claims and M12 indexed owner exposures. It now carries the owner's marked PnL, pending funding, marked equity, maintenance margin and liquidation deficit alongside the existing nominal accounting. `owner_marked_net_e7` is the owner book net **plus** unrealised marked PnL **after pending funding** and **after M11 debt**, but **does not mint margin**.

The previously named `full_perp_exposure_enumerated` field remains false whenever the *market* has open positions, because not all owners have been enumerated in one system-wide ledger. The new `m12_owner_marked_complete` indicates only that **this specific owner's** active M12 position set is internally verified. Market-level financing, external margin, portfolio liquidation, insurance sufficiency and third-party price governance still require independent review.

## Enforceable cross-product spot-only checks

`PortfolioAccounting.spot_reservation_safe(owner,amount)` is an actual read-only risk predicate: the owner must have sufficient M15 free collateral, nominal claims across M15/M11/M12 must be backed, and there must be **zero global M11 debt and zero global M12 open positions**. The requirement is intentionally more conservative than merely denying leveraged opens for the requesting wallet.

`CanonicalRisk.bind_products(portfolio,lending,perp)` requires the configured admin signature **while paused**, accepts a single immutable binding of three distinct sources, and cannot be called again. `authorization_enabled()` and unpausing require all three sources. Under `prepare_spot_reservation`, canonical risk checks actual M15 state, the bound fresh oracle, current accrued M11 debt, M12 position count, and the cross-product accounting predicate before issuing its exact owner-authorised one-use permit.

When M15 later calls `CanonicalRisk.approve_reservation`, the contract **rechecks current M11 debt and M12 position count in the same root transaction**, alongside the permit's owner/ID/amount/expiry and the refreshed oracle. It deliberately does **not** call the portfolio contract from within M15, avoiding Soroban's forbidden `M15 → Risk → Portfolio → M15` re-entry.

If an external loan or perpetual position is created after preflight and before permit consumption, M15 reservation **reverts** without consuming the permit or moving collateral. Failed cross-contract reads fail closed. The independent direct withdrawal, repayment, and liquidation exit paths remain available. The original M11 and M12 leverage approvals **always return false** in canonical risk and portfolio accounting.

## Verification, operational and security gates

Source coverage includes: both-sides position indexing, zero-sum marked PnL, positive/negative funding and >8h staleness, maintenance breaches, full-liquidation index cleanup, 32-position capacity, and real M15/M11/M12 cross-product snapshots. A native test uses a fully connected local M15 + M11 + M12 + portfolio + canonical spot-risk instance, demonstrating a new loan or open perp position **blocks consumption of an already prepared spot permit**. This is a native Soroban simulator with mock Testnet signers; it is **not public-network settlement evidence**.

```sh
cargo test -p hoxo-perp-clearinghouse --lib
cargo test -p hoxo-canonical-risk --lib
cargo test -p hoxo-portfolio-accounting --lib
stellar contract build --package hoxo-perp-clearinghouse
stellar contract build --package hoxo-canonical-risk
stellar contract build --package hoxo-portfolio-accounting
npm run check:readiness
```

Before any actual Stellar Testnet use, operator deployment review must validate the newly required `bind_products` transaction, contract code hashes, source identities, market/oracle configuration, admin signer, token mint/decimals, and complete receipt hashes. No automatic deployment, real transaction hash, independent audit finding or public beta has been claimed.

**Not complete:** audited market-wide position/liquidation solvency including all wallet offsets; shared M15 leveraged borrowing/perpetual margin, settlement and bad-debt waterfall; independent reviewer approval; real public Testnet signed transactions. Mainnet stays NO-GO.


## Subsequent market-wide bounded risk snapshot

In addition to owner snapshots, the clearinghouse now records every open position in a bounded market-wide index and verifies both counterparty wallet locks, funding and mark PnL. The global view sums potential maintenance deficits and gross insurance shortfalls across **all** currently open positions rather than treating a single position's prefunded insurance reserve as market-wide coverage. It enforces at most 64 active open positions in this review-only Testnet source, to bound Soroban computation. The cross-product portfolio now consumes this complete index. **This remains source-level accounting, not a verified audited liquidation engine or approval to leverage.** See [global market solvency](m12-market-wide-solvency.md).
