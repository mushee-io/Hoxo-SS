# M49 — XLM-PERP external orderbook and clear Testnet product status

## Why

The production Hoxo-SS chart now displays authentic external XLM/USD candlesticks, and M48 added actual Kraken spot and Stellar Testnet classic DEX bids and asks. However, a screenshot on an outdated M47 Vercel preview displayed the **Hoxo Fills/Trades** tab without a perpetual book, alongside an oversized and discouraging contract-warning banner. That presentation is poor UX and did not explain what was working.

## Delivered

- The top header now reads **STELLAR TESTNET · LIVE XLM CHARTS · EXTERNAL SPOT & PERP ORDER BOOKS · FREIGHTER WALLET**, instead of an always-visible negative block of contract implementation details.
- An accessible **PRODUCT STATUS** disclosure preserves the exact facts: the on-chain M9 spot settlement contract exists on Stellar Testnet and is paused, Hoxo's order matcher/trade execution is not enabled, perps and unified margin/lending are not live. Market data is external/reference and must never be reported as Hoxo volume.
- The XLM-PERP selector opens the **Live Order Book** tab automatically, even when the previous instrument had the **Hoxo Fills** tab selected. The Fills tab stays empty until actual Hoxo settlement receipts exist.
- XLM-PERP now defaults to an authentic *external perpetual* L2 orderbook, sourced from official Hyperliquid public mainnet API (`POST /info` with `type:meta` and then `type:l2Book,coin:XLM`). It verifies that XLM is in the **listed perpetual universe** before displaying prices; rejects wrong coin, malformed levels, crossed books, and snapshots older than 30 seconds. If the source fails or is unlisted, **no invented bids/asks appear**.
- Hyperliquid perpetual prices are **USD-denominated**, with USDC margin; clear labels distinguish the external perpetual book from Hoxo's own Stellar Testnet XLM-PERP execution. Optional Kraken spot XLM/USD comparison remains available. The Stellar classic Testnet offer book is available only for the XLM/USDC spot reference selector.
- Corrected the **REFERENCE PRICE** label on the XLM-PERP chart: the existing M47 chart shows Kraken *spot* XLM/USD candles, not a verified perpetual **mark price**. The mark/index, funding, open interest and other perps-specific figures remain unpopulated rather than fabricated.
- Automated tests exercise public API parsing and source validation, fresh snapshot guardrails, wrong/unlisted symbols, browser source switching, and the "Product Status" disclosure.

## What is not changed

M49 is market data and presentation only. Neither Hyperliquid nor Kraken reference books connect to a Freighter wallet or Hoxo M9 orders. The existing order ticket remains disabled and does not place positions. No automatic self-trading, market-making, on-chain unpause, margin lending or wallet transactions were introduced.

The real Hoxo Testnet XLM-PERP book requires **deployed Soroban perp clearinghouse + matching/order validation + margin and liquidation controls**, genuine signed executions, and a verified Hoxo indexer. External reference books are not evidence that those components exist.

## Release

The full JS, read-only Testnet and Chromium CI checks must pass, followed by READY Vercel preview for the exact current branch SHA. Deploying this UX safely does *not* authorize mainnet or Testnet spot/perp trading. The separate Draft PR #34 contains wallet-signing research and is not merged here.

For a current view use https://hoxo.mushee.xyz/app/?market=xlm-usdc-perp — not an earlier Vercel preview link containing `hoxo-p6xo7jj31`.
