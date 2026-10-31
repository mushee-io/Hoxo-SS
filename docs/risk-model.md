# Unified margin — conservative reference mathematics

**Scope:** The risk-engine JavaScript module gives reproducible USD accounting. It does **not** custody tokens, validate blockchain state, settle trades, transfer funds or approve Stellar transactions.

## Inputs and integer units
- USD values, token quantities and prices are decimal strings normalized to 8 decimals (1e8 scale). Native Stellar assets often have **7 decimal places**, so boundary adapters must normalize carefully.
- Collateral list: asset, amount, USD oracle price, factor in basis points (0..10000), oracle timestamp.
- Debt list: asset, principal **plus accrued interest** amount, USD oracle price, oracle timestamp.
- Perpetual list: market, signed base amount, entry USD price, mark USD price, IM/MM basis points, oracle timestamp. Funding payments and fees must be settled into canonical balances before evaluation, or included separately by the on-chain engine.
- Unique asset/market identifiers. Prices must be positive and timestamps within the freshness window.

## Risk metrics
- Gross collateral = sum(amount × USD price), rounded **down**.
- Adjusted collateral = sum(gross collateral × collateral factor), rounded **down**.
- Debt value = sum(debt amount × USD price), rounded **up**.
- Perp PnL = sum(signed base amount × (mark − entry)), rounded toward **negative infinity** for conservative losses/gains.
- Perp notional = sum(abs(base amount) × mark price), rounded **up**.
- Equity = adjusted collateral − debt + unrealized PnL.
- Initial requirement = sum(perp notional × IM ratio) + 20% of debt value (placeholder reserve).
- Maintenance requirement = sum(perp notional × MM ratio) + 10% of debt value (placeholder reserve).
- Available margin = equity − initial requirement.
- Health (bps) = floor(equity × 10000 / maintenance requirement), null with no maintenance requirement.
- Liquidatable if equity < 0 or, when there is a maintenance requirement, equity < maintenance requirement. Else initial-margin breach if equity < initial requirement; else healthy.

## IMPORTANT: parameters are illustrative
The 20%/10% debt reserves and any sample asset haircut or perp IM/MM factors are placeholders **not suitable to select actual leverage or lending risk**. A deployed system needs oracle design, correlated-asset risk, concentration limits, volatility stress, open-order reservations, interest/funding accrual, debt caps, market pauses, dynamic liquidation fees and dedicated risk review.

## Model limitations
This model does NOT:
- maintain authenticated balances or on-chain contract state;
- calculate interest/funding accrual or settle realized PnL;
- account for open orders, fees, market impact, slippage, insurance or liquidation auction mechanics;
- verify that supplied money-market collateral cannot also be spent as raw underlying;
- guarantee safe liquidation for a rapidly moving or manipulated market.

Every actual trade/loan/withdrawal must use independently verified on-chain inputs and enforce all constraints inside contracts. The reference model is only a first step.
