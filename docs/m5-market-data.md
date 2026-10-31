# M5: Stellar Testnet market-data adapters and halted oracle gate

M5 is a **read-only integration milestone**, not an authenticated trading oracle or live HOXO market listing. The existing Testnet contains independent Stellar SDEX trade history, but **the HOXO contract registry contains no verified issuer, Hoxo market or price contract**.

Implemented:

- `marketdata/horizon.mjs` loads independently observed Testnet Horizon trade records only after verifying current Horizon Testnet passphrase and ledger freshness, and labels those records clearly as *not HOXO fills*. It can query a configured issuer pair for `/order_book` and `/trade_aggregations`.
- `marketdata/model.mjs` validates precise Stellar asset type, issuer address, market identity and registry. The default pair registry `registry/market-data.testnet.json` contains **zero fully configured markets**.
- `marketdata/oracle-guard.mjs` is deterministic numerical price *review*, with separate source IDs, 2 observations, age <= 120 seconds, source deviation <= 150 bps, mark/index deviation <= 250 bps, and a default **kill switch**. The result is always `riskExecutable:false`, even if the arithmetic review passes. Source IDs are caller-supplied; there is **no cryptographic oracle proof**.
- `app/index.html` shows explicitly marked **independent Stellar Testnet network trades**, never populating HOXO order books or perpetual quotes from unrelated network activity.

Verification: `npm run test:marketdata`, `npm test`. Tests cover canonical asset query keys, wrong-network, invalid issuer, empty/unconfigured pairs, order-book ordering, candle arithmetic and oracle halt cases.

**Cannot yet enable**: index price, mark price, position valuation, lending collateral haircuts for risk decisions, liquidations, market order submission, real HOXO candles or volume. Those require independently verified oracle providers, approved assets and contracts, an on-chain oracle adapter and end-to-end settlement tests.

Official Horizon endpoints: <https://developers.stellar.org/docs/data/apis/horizon/api-reference/retrieve-an-order-book> and <https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-trade-aggregations>.
