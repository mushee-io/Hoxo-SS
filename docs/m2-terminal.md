# M2 — Stellar Testnet trading terminal

## Purpose
Develop one coherent trading workspace for Stellar spot, perpetuals, and money markets. M2 is a frontend workflow milestone; it does not create a live exchange.

## Deliverables
- Responsive multi-panel layout with chart, depth/funding tabs, order book/trades, order ticket, positions/balances and account overview.
- Reference-only searchable instruments: XLM/USDC and BTC/USDC (spot), XLM-PERP, BTC-PERP and ETH-PERP. The catalog does not imply real issuers, pairs, listings, or price feeds.
- Spot/perp context changes labels, order sides, available tools and selected query-string market.
- Chart/timeframe/order-book tabs switch explicitly unavailable states until verified market data is connected.
- Manual amount and limit-price inputs support a non-executable order draft, using seven-decimal integer math. Notional is based ONLY on a user-entered price, not a quote.
- Portfolio and money-market views distinguish wallet balances, protocol collateral and future position data.
- Basic keyboard interaction (Escape closes market selector), accessible labels and mobile layouts.

## Hard safety boundary
- Execution button remains disabled; there is no trade signing or submission.
- Deposits/withdrawals, borrowing, leverage and TP/SL are not enabled.
- There are no fabricated market prices, positions, volume, fills, funding rates or order-book data.
- The network indicator validates the expected Stellar Testnet passphrase and current ledger freshness; this does not mean a contract is deployed.

## Acceptance
1. Run npm test and npm run test:terminal on Node 20+.
2. Open /app/?market=btc-usdc-perp and verify that the selection is BTC-PERP.
3. Verify reference-market search and Spot/Perp filters and Escape-to-close.
4. Verify chart, timeframes, order book and trade tabs change unavailable messages.
5. Type order size and an optional user-supplied limit price. Confirm no price is invented and execution cannot occur.
6. Check layouts at mobile, tablet and desktop widths in a hosted browser.

## Pending
Hosted preview/browser visual verification remains blocked by the Vercel 403 project-creation permission. M3 real-wallet QA and M5–M14 network markets, clearing and margin contracts are separate milestones.

## Browser smoke suite

The independent CI job **M2 Chromium trading terminal smoke** starts a local static server and launches headless Chromium, tests Spot/Perp deep links, market filters, chart/order-book tabs, limit-price drafts, mobile Escape-to-close, disabled execution and 375px horizontal-overflow. It intentionally blocks third-party requests, while the separate real Testnet Horizon check verifies external network reachability. A hosted Vercel visual review is still required.
