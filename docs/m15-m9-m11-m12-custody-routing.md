# Atomic M15 ↔ M9/M11/M12 custody transfers — Testnet source only

**Status: software / native Soroban source and tests. Financial Testnet beta CLOSED, no external security audit, and no independently verified Hoxo live contract deployments.** This feature is an explicitly isolated *custody handoff*, not a full shared leveraged margin account. The original seven canonical Hoxo contract roles remain planned with null deployed addresses; the new router is an additional, unverified auxiliary candidate, not a registered deployed contract.

## The architecture

The existing contracts hold separately accounted real tokens:

- **M15** has one token-backed margin vault with owner **free and reserved** balances and a global aggregate user-claim ledger. An owner may withdraw only free collateral.
- **M9** completes a genuine dual-wallet, two-token delivery-versus-payment match with maker/taker wallet authorisations and replay-protected 32-byte match IDs, not an M15 reserved order.
- **M11** records separate share claims, debt shares, borrow indexes, and token cash. Its supply/redeem operations are against the independent money-market vault. This integration refuses the handoff unless **borrowed debt is exactly zero**; share redemption remains available directly if the router or M15 is paused.
- **M12** holds its own independent perp-collateral wallet claims, locked/open positions, insurance and PnL. This integration refuses either direction unless **open position count is zero**; M12 user withdrawals remain available directly when paused.

A source-level "risk enabled" flag in M15 is never sufficient to claim borrowing or derivatives are safe. The previous M15 chain-backed risk contract **continues to deny** all new M11 borrowing and M12 perp opens.

## New `hoxo-custody-router` contract

The router is a standalone Soroban contract requiring a canonical Testnet network ID, exactly matching audited seven-decimal token address across M15/M11/M12, distinct actual contract addresses, an admin signature and a manually unpaused state. It has an immutable **1,000 token maximum per operation** and **no route to borrow, liquidate, open a perpetual, access another user's balance or enable financial beta**.

### M9: settle quote collateral inside M15

`settle_spot_from_margin(MatchTerms)` performs *one atomic Soroban root invocation*, with both buyer and seller authorisations:

1. Confirm the **quote** token is the M15 collateral asset, the **base** token differs, all assets are allowlisted by M9 and both users are different.
2. Verify the buyer has free M15 quote collateral; `M15.withdraw(buyer, quote_amount)` debits buyer available quote and aggregate claim, moving those actual tokens from M15 to the buyer.
3. Call the original `M9.settle(terms)`. It enforces both signed maker/taker sides, exact two-token delivery, matching order constraints, fresh expiry and match-ID replay denial. The buyer pays the quote from their actual wallet, and the seller delivers base.
4. `M15.deposit(seller, quote_amount)` returns the seller's just-received quote to M15, increasing their free balance and restoring total vault claims. The buyer's M15 free balance declines while the seller's increases by exactly the quote amount.
5. Re-read canonical token balances and M15 state: global M15 token holdings **unchanged**, claims **unchanged**, buyer/seller external quote wallet balances **unchanged**, and buyer/seller base balances changed by exactly the matched base amount. Any mismatch causes the **entire transaction to revert**, including M9's replay tombstone.

This creates actual atomic **M15-funded free quote collateral** settlement in an M9 base/quote trade; it is not an M15 *reserved* order settlement and should not be described as a unified order book or permission to spend locked margin.

### M11: actual custody migration, not shared debt collateral

`supply_from_margin(owner, amount)` calls `M15.withdraw(owner, amount)` and then `M11.supply(owner, amount)` in one Soroban root invocation. It checks the same real valueless token left the M15 vault and entered the M11 pool, that M15 global user claims decreased exactly by the same amount, that the owner's external wallet is unchanged, that shares are actually minted, and that both vaults remain solvent. It additionally checks the actual M11 `outstanding_debt_e7() == 0` **before and after**.

`redeem_to_margin(owner, shares)` redeems actual isolated M11 shares, obtains the *actual* token amount returned by M11, then deposits exactly those tokens into M15. The token and global claim deltas are verified; any error rolls back both operations. The router cannot redeem another user's shares or borrow money by crediting phantom M15 collateral. If M15 is paused, the atomic return will revert rather than leave an in-between state; the owner retains their direct M11 redeem route outside this router.

### M12: actual isolated perp escrow migration, not shared leverage

`perp_from_margin(owner, amount)` withdraws free M15 token collateral, then executes `M12.deposit(owner, amount)`. `perp_to_margin(owner, amount)` uses M12 free-balance withdrawal before M15 deposit. Each verifies exact physical token transfer, M15 global-claim delta and unchanged owner wallet balance. Both routes check `M12.active_positions() == 0` before and after.

**No route uses M15 collateral to open an M12 position** or pays funding/insurance/keeper fees out of that account. The independent M12 risk controller is still responsible for denying leverage. Existing M12 withdrawals of independently free collateral remain available even if the router is paused.

## Fail-closed design

- All token/custody paths use only on-chain Stellar Testnet Soroban contract calls, never local JavaScript account balances or off-chain M8 intent as spending authority.
- A router constructor does not accept unsigned prices, arbitrary accounts or a remote user-provided RPC.
- Only free collateral may leave M15. M15 reserved tokens cannot be handed to other products.
- M11 requires **no outstanding debt**, and M12 requires **no active positions**, so previously locked liabilities cannot be represented as free elsewhere.
- The full *root invocation is atomic*. An M9 invalid price, M11 supply-cap/pause failure, M12 collateral error, insufficient M15 balance or token accounting discrepancy reverts all changes, including preceding token transfers and claim modifications.
- `router.pause(true)` requires its admin signer; deploys initially paused and do not self-authorise financial beta.
- All methods reject wrong-network calls, nonpositive quantities and amounts above the fixed limit.
- Real product exit functions are **not replaced** by these convenience routes. A paused or unavailable router cannot confiscate already-existing M11 shares, M12 collateral or free M15 withdrawal rights.

## Files and tests

| Path | Responsibility |
| --- | --- |
| `contracts/custody-router/src/lib.rs` | Source-level atomic real-token M15/M9/M11/M12 handoff |
| `contracts/custody-router/src/tests.rs` | Native two-user Soroban tests for 2-sided M9 settlement, M11 share return, M12 collateral return, replay denial, wrong token, zero liquidity, paused branches, auth and fund conservation |
| `contracts/money-market/src/lib.rs` | New read-only `outstanding_debt_e7()` getter from actual pool debt |
| `contracts/perp-clearinghouse/src/lib.rs` | New read-only `collateral_asset()` and `active_positions()` getters |
| `.github/workflows/test.yml` | Native integration tests and review-only compiled router WASM artifact |

Run locally:

```sh
cargo test -p hoxo-custody-router --lib
cargo test --workspace --all-targets
stellar contract build --package hoxo-custody-router
npm run check:readiness
npm run m21:readiness
npm run m22:readiness
npm run m23:readiness
npm run m24:readiness
```

**No real Stellar wallet signed or broadcast a financial transaction** through these tests; `e.mock_all_auths()` is a local simulator. An independent audit, secure operator credentials, actual Testnet source/WASM deployment IDs and ledger receipts remain required before anyone can use the router for Testnet financial transactions.

## Work remaining for genuine cross-product unified margin

1. Add audited **M15 reservation-aware** spot settlement (not just free quote), real order-signed adapter authentication, stable oracle valuation and two-token settlement without double-counting.
2. Replace or reconcile M11's debt share ledger with canonical M15 collateral/debt and interest shares; establish enforceable liquidation and borrowing limits across both on-chain contracts.
3. Replace or reconcile M12's collateral, funding/PnL, insurance and positions with canonical M15, including non-recursive real on-chain risk checks and cross-product liquidations.
4. Prove multi-wallet end-to-end transaction receipts and before/after on-chain solvency through actual Testnet deployments and independently verified asset issuance.
5. Commission independent smart-contract/economic audits and separate legal/risk/governance release approvals; M23 public financial beta and M24 mainnet stay **CLOSED/NO-GO**.

**In short:** the router connects the custody and settlement paths **with real token-backed atomic operations in the native Soroban test environment**. It deliberately does **not** pretend that leveraged borrowing and perpetuals already share executable M15 collateral.
