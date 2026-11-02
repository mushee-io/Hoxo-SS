# M47 — Real moving XLM/USD candlesticks (independent chart-only release)

**Goal:** Replace the static "NO VERIFIED MARKET DATA" chart on Hoxo's XLM/USDC reference workspace with genuine recent XLM/USD OHLC candlesticks from Kraken's public spot market, updating via Kraken's public OHLC WebSocket and a periodic REST refresh.

## What users see

- Visually moving candlesticks, real volumes and real price axis. Timeframe buttons: 1m, 30m, 1h, 4h and 1d.
- A clear **KRAKEN XLM/USD — EXTERNAL SPOT REFERENCE** label, indicating prices are USD, not testnet USDC. No claim of an executable Hoxo quote.
- A source-labelled last Kraken XLM/USD reference price, not a verified Hoxo trade price.
- Kraken public WebSocket OHLC for updates when there are actual trades, with a 45-second history refresh; no artificial price animation or synthesized candles. If price data fails or is stale, the chart says so.
- The chart is available for the XLM spot/perp reference selection. Other instruments and Depth/Funding tabs retain the existing disabled/unverified state.

## Technical design

- app/m47-live-candles.mjs: canonical parsing of Kraken REST/WS OHLC messages, data validation, chronological merge and stale replay protection.
- api/market-candles.js: public Vercel serverless OHLC proxy restricted to XLMUSD and supported intervals, cache up to 15 seconds. Does not store keys or wallet data.
- app/m47-live-chart-ui.mjs: responsive HTML Canvas candlesticks + true Kraken market volume and source text. Uses a real browser WebSocket and falls back to direct Kraken REST when the serverless API is unavailable. It does not sign, submit, settle or place offers.
- app/index.html, terminal-ui.mjs and terminal.css: show feed, update on chart-tab or timeframe changes, and keep the existing normal Buy/Sell action disabled.

## Critical distinction

Kraken **XLM/USD** (external exchange, USD-denominated) is not an on-chain Hoxo **XLM/USDC** (Testnet) order, price oracle, or execution feed. The external reference candlesticks do **not** prove Hoxo liquidity, live Testnet settlement, volume, counterparties or a functioning market maker. Wallet balances remain connected separately, while M9 on-chain settlement remains paused and no trade is executed from this feature. A real Hoxo Testnet spot chart needs bona fide independent on-chain settlement events to populate an exchange-specific candle feed; do not manufacture such data with repeated self-trades.

## Release separation

This chart-only PR targets **main** independently of Draft PR #34 (M43–M46 signing/lifecycle work), so moving reference charts can launch without exposing unreviewed wallet transaction capabilities. GitHub regression and browser tests must pass; the Vercel build must reach READY for this **exact commit** before promoting. Do not confuse an older READY preview with this code.

## Tests

- npm run test:m47
- npm test
- npm run test:browser (Chromium installed in GitHub CI)

Test fixtures produce deterministic **mock** candles only in CI, never production.
