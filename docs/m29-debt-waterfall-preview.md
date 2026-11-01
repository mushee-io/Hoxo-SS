# M29 — read-only realised-debt waterfall preview

This milestone adds a **pure, exact-integer accounting preview**, not a Soroban liquidation engine. The inputs are restricted to accrued debt, actual realised collateral proceeds, prefunded insurance and liquidation costs **all in the same canonical e7 token**. The preview deliberately has no fields for unrealised perpetual PnL, hypothetical oracle collateral value, nominal lending receivables, cross-asset prices or trade authority.

The priority is to establish a conservative reference model for future on-chain M11/M12/M15 debt settlement. Collateral pays funded liquidation costs first, then outstanding accrued debt. Prefunded insurance covers only remaining debt; uncovered debt remains a visible lender shortfall. Excess realised collateral is a borrower surplus, not a second pool claim. Unfunded liquidation costs remain explicit. The result always says `executable:false` and `riskApproved:false`.

Run `node --test tests/cross-product-waterfall.test.mjs` for deterministic scenarios and exhaustive small-balance conservation cases. This does not test Soroban atomicity, signer authorisation, interest freshness, oracle freshness, real token movements, liquidity depth, or whether liquidation can actually obtain the assumed proceeds.

**Next:** implement and review the canonical Soroban settlement authority with authenticated debt and realised proceeds, exact token transfers, guarded reentrancy, liquidation and insurance limits, state-transition invariants and rollback tests. Only then perform genuine operator-signed Stellar Testnet deployment and transactions. Public financial beta CLOSED; mainnet NO-GO.
