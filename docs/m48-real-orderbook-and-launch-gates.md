# M48 — Genuine automatically updating orderbooks + accurate Testnet status banner

## Fixed terminal behavior

- The misleading "spot execution, lending and unified margin contracts are not yet deployed" blanket claim is corrected: M9 spot settlement **is deployed on Stellar Testnet and paused**, while Hoxo's spot matching / Buy-Sell execution remains disabled. Perps, lending and unified margin are not operational.
- The orderbook panel can now show **real red/green ask/bid levels** with actual prices, XLM sizes, depth shading and observed spread. Updates poll every 6 seconds while the book is visible, with an explicit refresh button.
- Source selector:
  1. **Kraken XLM/USD external spot book** (default): real public bids and asks. Currency **USD**, not USDC. This gives a moving independent reference market like the newly deployed candles. It is **not Hoxo liquidity or executable from Freighter**.
  2. **Stellar Testnet XLM/USDC classic DEX**: exact base XLM and issuer-specific Testnet USDC, directly sourced from Horizon. These are classic Stellar offer levels, **not M9 Hoxo offers**. If the Testnet market is genuinely empty, show **NO LIVE OFFERS** rather than invented orders.

Both sources have strict market/issuer checks. Kraken's Depth response must contain *exactly* XLM/USD; an unrelated market is rejected. Horizon must have native XLM as base and Testnet Circle-issued USDC as counter. An unknown/failed response clears the orderbook; it never fabricates liquidity or preserves stale levels as current.

## Existing funded wallets and live execution limitations

- M9 spot contract: `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF` (Stellar **Testnet**), currently paused.
- Maker (Wallet 1) public address: `GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB`.
- Taker (Wallet 2) public address: `GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2`.
- Circle Testnet USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- The operator previously funded both Testnet accounts with Testnet XLM/USDC and approved the assets for M9; fresh readiness must be checked before any signing. **USDT is not USDC.** Mainnet or real-money funds should not be sent to this Testnet system. Never request S-keys, private keys or recovery phrases.

M48 is deliberately **read-only**. It does not place classic DEX offers, call a market maker, auto-trade, unpause M9, sign wallet envelopes or submit any Testnet transactions. Showing a real external orderbook is not proof that Hoxo can route or settle orders. Actual spot settlement still requires independently reviewed wallet-approved invocation, funded maker/taker authorizations, an explicit activation decision, genuine on-chain receipts and balance reconciliation. Perpetuals/lending/unified-margin require separate deployed and secured contracts.

## Verification

- `npm run test:m48` and `npm test`: real data shape validation and fail-closed market identity checks.
- `npm run test:browser`: deterministic Chromium test fixtures are **tests only**, not shown to production users. The UI must display real live sources or a truthful unavailable/empty state.
- Production Vercel preview requires a READY deployment of the **exact PR head SHA**; do not merge based on an old preview.

The code is separate from Draft PR #34 to avoid deploying unfinished Freighter signing and settlement capabilities by accident.
