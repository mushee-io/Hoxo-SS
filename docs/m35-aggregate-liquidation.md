# M35 — Shared insurance budget across liquidation batch

**Status: read-only JavaScript reference only. Stellar Testnet financial beta CLOSED.**

The M29 single-position debt waterfall can safely allocate a given insurance budget for one position, but running it independently for several liquidations with the same insurance balance would double-count that reserve. M35 adds `previewAggregateLiquidations` in `risk/aggregate-liquidation.mjs` to deplete one shared reserve sequentially across up to 64 positions.

The model uses exact e7 bigints, rejects invalid signed i128 inputs, duplicate position IDs, unexpected properties and getters, and checks conservation of collateral, costs, debt and insurance across the whole batch. The input order determines which borrower gets scarce insurance first. **That ordering is not an approved keeper policy**, and the function cannot approve trading, seize collateral or settle any debt.

Run `npm run test:m35` or `npm test`.

## Outstanding executable Soroban work

1. Source the debt including accrued interest from authenticated M11 contract state and the realised collateral from authenticated M15/M12 transfers, not caller-supplied hypothetical amounts.
2. Specify and audit deterministic liquidation priority and fairness, fees, per-market reserves and actual shared insurance ownership. A 64-position batch bound is a preview limit, not proof of exhaustive market exposure.
3. Implement single-root atomic Soroban token movements, debt share burning, lender repayment, insurance consumption, borrower surplus and persistent bad-debt accounting; test reverts on every failed transfer and invariant.
4. Verify canonical token addresses, reviewed WASM, all deployment receipts, fresh oracle/risk gates and independent security review before valueless Testnet execution.

This module is intentionally disconnected from execution paths. It does not establish live trading, an audited loss waterfall, or deployment evidence.
