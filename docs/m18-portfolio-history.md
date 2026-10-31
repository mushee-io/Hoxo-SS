# M18 — Portfolio and Transaction History

**Status:** Implemented as a **read-only, source-separated Testnet wallet activity + signed sandbox history foundation**. It is NOT a live Hoxo exchange portfolio. All seven planned Hoxo Soroban contract IDs are still `null`, and no legitimate M5 on-chain oracle, canonical risk authority or custody/trading receipts have been established. Therefore real exchange positions, PnL, funding, lending interest, transfers into Hoxo vaults and actual Hoxo trade history **must not** be invented.

## Source 1: public Stellar wallet payments

`portfolio/stellar-history.mjs` exposes `loadStellarWalletActivity(owner, {fetchImpl,nowMs,limit,cursor})`, using only `https://horizon-testnet.stellar.org`, `GET /` to validate the **exact Testnet passphrase** and fresh latest ledger, `GET /accounts/{owner}` to validate the account ID and real Horizon balances, then `GET /accounts/{owner}/payments` to retrieve confirmed *public indexer-reported* payment operations.

Every returned operation is checked for payment type, successful transaction flag, transaction hash, ledger within the observed range, non-future creation time, exact decimal amount, valid Stellar source/destination G-address, actual account involvement and genuine asset issuer identification. Duplicate operation IDs/paging tokens, unsupported path-payment route data, malformed values, wrong network, mismatched account IDs or stale network proof **fail closed** rather than being presented as history.

Results carry `provenance: STELLAR_TESTNET_HORIZON_REPORTED`, `hoxoTrade:false`, `hoxoDeposit:false`, `executionPermitted:false`. A Horizon response is a public network indexer observation, **not independent cryptographic transaction verification or proof the requester owns that account**. In the UI this query is restricted to a Freighter-connected, Testnet-verified wallet identity. Public API queries remain publicly address-queryable, not proof-of-ownership endpoints. Payment records are **not** Stellar SDEX trades, Soroban vault settlements, Hoxo PnL or proof of on-chain margin.

The **Transfers** tab in the existing trading terminal displays limited read-only payments and a Testnet explorer transaction link, preserving an explicit **NOT HOXO TRADES** badge and account-specific errors. It supports a bounded `LOAD MORE` cursor. Unknown, malformed or unsupported payments never become synthetic transfer entries.

## Source 2: signed journal, non-executable history

`portfolio/sandbox-history.mjs` projects the existing M8/M17 signed, hash-chained and fsync-persisted journal into owner-scoped:
- open sandbox orders, pending conditional TP/SL orders and their recorded lifecycle transitions;
- simulated maker/taker fills (`NOT_SETTLED`);
- hypothetical signed perp exposure from locally simulated fills.

The journal first verifies every signature, nonce and hash chain on restart. Pagination is bounded, and owner-scoped history cannot include other accounts. Local exposure has `entryPriceE7:null`, `realizedPnlE7:null`, `unrealizedPnlE7:null`, because simulated marks and unmatched orders do not prove real cost basis, position ownership or fund movement.

**Real positions, PnL, funding, lending interest and settled Hoxo trade history return `status:"UNAVAILABLE"` with explicit reasons**, an empty `records` array and `amountE7:null`. This is not a real empty financial balance, and must not be represented as zero profit/debt. The sandbox source is always labelled `M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN`.

## Read-only API (local-only)

The existing loopback API adds:
- `GET /v1/portfolio/sandbox?owner=<G-address>&limit=25&cursor=0` — signed-journal order, simulated-fill and simulated-position history, with unavailable real-financial fields.
- `GET /v1/portfolio/wallet?owner=<G-address>&limit=25&cursor=<Horizon-payment-token>` — fresh network-validated public Horizon wallet payments, balance metadata, observed ledger and explicit unavailable Hoxo sections.

These are **public address lookups**, not authenticated private portfolio or payment authorisation. The server never obtains private wallet keys, never broadcasts a transaction, still requires an independent Ed25519 intent for existing sandbox *write* commands and leaves real on-chain custody/trading disabled.

## Tests

```sh
npm run test:portfolio
npm run test:matching
npm run test:advanced
npm test
npm run check:readiness
npm run test:browser
```

CI covers stale/wrong network, mismatched account, invalid issuer, ledger/tx hash failures, duplicate pagination records, cursor injection, no fabricated unfunded history, incoming/outgoing/self-transfer attribution, testnet ledger provenance, owner-scoped replay, tamper resistance, no fake real PnL, read-only HTTP and disabled transaction routes.

## Remaining M18 acceptance gates

1. **Verified deployed contract registry** for vault, money-market, perp clearinghouse and settlement, independently queried to validate contract ID, code hash, current ledger state and signed transaction receipts. All registry IDs are still null.
2. **Authenticated contract indexer** for deposits, debt accrual, spot trades, perpetual positions, realized PnL, funding settlement, liquidation, reserve movements and archival restoration; enforce de-duplication, ledger ordering, reorg/rollback and testnet reset reconciliation. That work is also planned for M19.
3. **Canonical wallet ownership and account mapping** for private portfolio access, wallet-specific signing, and permissioned actions; public Horizon address lookups alone do not authenticate the requester's ownership.
4. **Independent Stellar Testnet signed end-to-end acceptance**, adversarial audit and portfolio reconciliation against the on-chain vault. Never use simulated positions or public payment transfers to claim Hoxo open interest, trading volume, yield or protocol revenue.

**M18 read-only engineering is buildable and tested; authenticated live Hoxo positions, PnL, funding, interest and trades remain blocked.**
