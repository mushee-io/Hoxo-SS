# M59 — Verified Hoxo Stellar Testnet market activity

The Hoxo terminal now defaults to **Stellar Testnet** price and volume evidence rather than displaying an external Kraken market as if it were Hoxo's exchange.

## Evidence-only transaction feed

The public, read-only endpoint `/api/hoxo-testnet-activity` queries the canonical Stellar Testnet M9 contract `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF` using official Stellar SDK RPC:

- Check exact Testnet passphrase and current ledger.
- Query M9 contract events over the **most recent 3000 ledgers** (not 24-hour or all-time figures).
- Decode only the `SpotSettled` contract event with exact `hoxo_spot, settled, match_id` topics; verify XLM/USDC token addresses, distinct account addresses, signed 7-decimal amounts, and settlement ledger.
- Independently retrieve each corresponding transaction; only successful transactions with the **same transaction hash and ledger** are counted.
- Deduplicate match IDs, sum exact XLM and Testnet USDC integer amounts, link transaction hashes to Stellar Expert.
- Emit `503 unavailable` rather than invented zeroes if RPC evidence cannot be verified. If no genuine events exist in the **checked window**, report exactly zero verified settlements.
- Never present USD market reference volume, unrelated Stellar Classic DEX trades, simulations, GitHub tests, internal wallet transfers, or unsigned intents as Hoxo spot fills.

**Scope:** This is a bounded, most-recent-3000-ledger sample. It does not prove all-time trading volume, third-party users, independence of beneficial owners, economic activity, TVL, or grant traction. Two wallets controlled by the same person exchanging Testnet tokens cannot honestly be represented as independent organic market volume.

## Trading controls

The spot Buy/Sell ticket now opens the existing controlled M45/M52/M55 bilateral settlement workflow. It is **not** an automatic market buy or public order-matching service. Both Freighter wallets must approve, the final send requires a separate typed confirmation, the exact transaction is re-verified, and on-chain finality must be independently checked. No background trading, account keys, seed phrases, mock fills, or automatic transaction signing are introduced.

XLM-PERP trading is not automatically activated: verified clearinghouse, oracle, risk engine, deposited margin and liquidation solvency remain required. External market data, where separately displayed for research, is never Hoxo liquidity or executed price.

## Build and acceptance

Run `npm run test:m59`, `npm test`, `npm run build` and full GitHub Chromium/Soroban CI. Inspect the deployment and run the real two-wallet Freighter acceptance before claiming first signed Testnet settlement.

**Production must show an exact verified release SHA.** A READY preview, a GitHub merge, or passing CI does not prove `hoxo.mushee.xyz` was promoted. Vercel previously returned 403 for production deployment; an authorised project member must release it.
