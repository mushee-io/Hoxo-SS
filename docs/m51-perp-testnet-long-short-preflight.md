# M51 — XLM-PERP Long/Short Testnet signing and settlement foundation

## What is implemented

- Bilateral XLM-PERP **LONG / SHORT** terms for maker and counterparty, exact 7-decimal quantities/limit prices, new unique position ID and 15-ledger expiry.
- Independent chain readiness preflight requiring actual distinct independently verified Testnet deployments for the **perp clearinghouse (M12), oracle adapter (M5), canonical risk engine (M7), and unified margin (M15)**, matching on-chain WASM SHA256 and registry contract IDs. It rejects future proof ledgers or wrong networks. No reliance on Kraken/Hyperliquid market-data labels as a price oracle.
- Official Stellar RPC **read-only Soroban queries** check exact collateral SAC, market ID, paused flag, oracle/risk configuration, canonical market-wide exposure index, reserve/insurance coverage, solvency, fresh on-chain mark/index, price deviation, realistic fee cap and BOTH counterparties' **isolated on-chain margin**. Horizon wallet USDC alone is not deposited margin.
- On a fully verified and funded mock fixture, build an actual **one-operation unsigned Stellar SDK XDR transaction** calling the exact Soroban `open(id,long,short,quantity,long_max,short_min,expiry)` ABI. Guard source wallet, exact amount bounds, only one operation, no signatures and bounded fee.
- Regression tests use distinct checksum-valid **mock** StrKeys and deterministic fake deployed WASM; the mocked registry is never written to the real Testnet registry.

## What is still blocked

The main Testnet registry currently records `perp-clearinghouse`, `oracle-adapter`, `risk-engine` and `unified-margin` as **planned / null**. The guard refuses to simulate, sign or send before independently verified genuine deployments and risk review. This is the correct safety state, not a code error.

For genuine Testnet Buy/Long and Sell/Short users must eventually:

1. Deploy, validate and register the proper Soroban M5/M7/M12/M15 contracts with immutable asset and signed publisher policy.
2. Confirm a current on-chain oracle mark/index and independent funding/fee/risk controls, with isolated collateral **deposited on-chain** by both distinct counterparties.
3. Simulate the exact signed intent, verify all Soroban source and non-invoker auth entries, limits, fees and expiry, then obtain both users' explicit Freighter approvals.
4. Only after independent security review, operator authorisation and passing source/compiled-WASM inspection, submit a small Testnet transaction and verify chain receipt, balances and matching PnL/position.
5. Release a controlled Testnet beta only after the first genuine settlement and independent security clearance. External Kraken and Hyperliquid depth are market **references**, not native Hoxo order book liquidity or executable counterparties.

## Release hold

**GitHub-only branch and draft PR. Do not merge to `main`, deploy to Vercel, promote hoxo.mushee.xyz, unpause M9, request private wallet keys or sign/send transactions.** This code is a real typed on-chain contract integration preparation, **not** proof that Hoxo perps are already trading.

Tests: `npm run test:m51perp` and full `npm test`.
