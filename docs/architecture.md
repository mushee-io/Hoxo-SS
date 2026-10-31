# Hoxo-SS reference architecture

## Objective
Spot, perpetuals, and lending/borrowing must share **one on-chain margin-account state**. A frontend view which sums three independent applications does not count as unified margin.

## Modules
1. **Margin account + collateral vault (Soroban):** wallet-authenticated deposits/withdrawals; allowlisted assets; account IDs; tracked settlement balances; dust/rounding controls; asset custody; account-level isolation.
2. **Spot execution adapter:** initial routing through vetted Stellar execution venues or dedicated Soroban spot contracts, with exact input/output checks. Classic Stellar DEX balances/offers are NOT vault assets until confirmed in vault accounting.
3. **Money market pools:** each market has reserve accounting, utilization-indexed borrow rates, supply claim tokens, repayment, permissionless liquidation. Borrowing contributes liabilities to the common margin account.
4. **Perpetual clearinghouse:** linear perps, positions, entry price, funding index, realized/unrealized PnL, fee accounting, insurance fund and atomic liquidation settlement; orders may match off-chain but settlement MUST be verified on-chain.
5. **Risk engine:** on-chain validated, canonical prices and positions; collateral haircuts, liability valuation, margin requirements, initial/maintenance tests. The JavaScript reference package is a testable specification, not an enforcement boundary.
6. **Oracle adapters:** explicit oracle sources, asset-specific freshness/deviation limits, market pauses on stale/untrusted prices; market/index/mark prices appropriately separated and guarded.
7. **Indexer/API:** events and ledger queries for portfolio display and order history; non-authoritative. Never treat indexed values as proof of available collateral.
8. **Trading terminal:** wallet connect, account value, spot order ticket, perps ticket, borrowing/supplying, health bar, funding estimates, liquidation price and transaction receipts, with explicit loading/unsupported states.

## Critical invariants
- Cross-product state changes run atomically, applying pre- and post-risk checks.
- Unsettled orders reserve margin. Do not allow an order and withdrawal to each consume the same liquidity.
- Money-market supply receipts and underlying deposited assets must **never** both count as collateral.
- Borrow liabilities include accrued interest and fees on-chain.
- Price decimal conversions and 7-decimal Stellar asset amounts are normalized explicitly when crossing asset/contract boundaries.
- A user signature authorizes withdrawals, loans and trades; privileged roles cannot withdraw users' assets.
- Liquidation must be economically viable with keeper incentives, bad-debt absorption and insurance.
- Any pause/upgrade powers have transparent governance, timelocks, monitored multisig and failure modes.
- No front-end shortcut or external matching engine can bypass on-chain validation.
- Isolate testnet state from mainnet. Never present testnet funds/volume as real user value.

## Initial network
Stellar TESTNET (Stellar smart contracts, Rust `soroban-sdk`). Production chain, oracle feeds, token contracts and approved third-party integrations remain intentionally unconfigured.

## Execution sequence
Collateral vault -> asset registry/oracles -> independent lending and spot adapters -> perp clearing -> integration invariants -> wallet-signed testnet end-to-end flows -> external audit.
