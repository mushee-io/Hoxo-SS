# M41 — Real Stellar Testnet XLM / Circle test-USDC readiness

**Still no public spot trading.** This milestone makes the first `XLM/USDC` bilateral Soroban test trade operationally checkable without storing or accessing private keys. It does not mint assets, install trustlines, unpause Hoxo, place an order, count volume, or sign anything.

## Known public candidate evidence

- Hoxo M9 Spot contract: `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF`.
- Hoxo M9 administrator/first trader: `GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB`.
- Second trader: `GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2`.
- Code hash: `916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3`.
- Native XLM Stellar Asset Contract on Testnet: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.
- Circle **Testnet** USDC issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- Its corresponding Stellar Asset Contract (SAC): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Both SAC addresses are *candidates until live RPC verifies the correct derived asset-contract IDs and seven-decimal token methods*. Use the canonical `Test SDF Network ; September 2015` passphrase only.

The separate human-provided Testnet `getLedgerEntries` RPC proof for the M9 contract reported exact code hash, expected admin and `Paused=true`, at ledger 5507087. M41 independently checks contract instance, code hash, admin and pause state anew on every run; never infer current readiness from an old report.

## Browser-free read-only verification in GitHub Actions

- A [dedicated M41 GitHub Actions workflow](../.github/workflows/m41-spot-assets.yml) can run without a wallet or secrets on pull requests, merge to main and manual re-run. It prints signed-wallet blockers and Token SAC identity results into the job log.
- `npm run test:m41` tests wrong chain, wrong hash, wrong admin, missing trustlines, misleading simulated values, false volume and precision attacks.
- `npm run check:spot-assets` uses public Horizon + Stellar RPC only: `getNetwork`, `getContractInstance`, `queryContract` and `GET /accounts/<public G-address>`. It never broadcasts a transaction or writes the registry.

The script checks SDK-derived XLM/USDC SAC addresses and actual on-chain methods/decimals. It reports the two wallets' seven-decimal XLM/USDC balances and exact trustline/authorization state, M9 allowlist flags, and pause status. It always returns `executionPermitted:false`, `tradingEnabled:false`, `confirmedVolumeE7:"0"`, even when all asset configuration checks pass.

## What the operator must do next in Freighter

**Use only valueless Testnet funds.** Never import a secret seed into Stellar Lab or paste a recovery phrase into any chat.

1. Keep both Freighter accounts set to **Testnet**. Both previously had sufficient native Testnet XLM; check balances again.
2. Have **each account** sign a classic Stellar `Change Trust` operation for **USDC** issued by the **exact** public key `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` using Stellar Lab / Transactions. Verify code `USDC` and issuer in transaction details. No asset trustline belongs to an unrelated issuer.
3. Only after trustlines appear in Horizon, obtain valueless USDC for the **second wallet** using a legitimate issuer-specific Testnet faucet, e.g. Circle's Testnet faucet if available. This is not real/mainnet USDC. No one should transfer real funds.
4. Review the on-chain two SAC token contracts' seven-decimal interface and verify wallet balances directly. The second trader must have enough USDC to pay the agreed small quote; the first wallet supplies XLM.
5. Separately review each administrative `set_asset(asset,true)` request on the exact M9 contract and each approved SAC ID. The owner must sign both; no contract admin may be inferred from a generic transaction source.
6. **Only after security and contract-flow review**, sign the exact `set_pause(false)` invocation on M9. Keep leverage/perps/margin/lending disabled.
7. Complete a **single small two-party M9 `settle(MatchTerms)`** transaction with wallet-authenticated maker and taker, two distinct order IDs, precise seven-decimal quantities, distinct token C-addresses, limits and a short fresh ledger expiry. The transaction must include the correct Soroban auth tree for both wallets. The existing `matching/m9-wallet-settlement.mjs` CLI demonstrates this using externally controlled Node keypairs, **not Freighter**; a distinct browser-based two-wallet Freighter signing path is still required and must not be claimed operational prematurely.
8. Check actual success in Testnet RPC, the `receipt(match_id)` record, `is_settled(match_id)`, and before/after balances. Only ledger-confirmed trades between distinct **independent** owners count as genuine liquidity/user volume. Trades between accounts owned by the same person must be labeled internal Testnet checks, not external market-making demand or traction.

## Fail-closed activation conditions

No new real orders can be authorized based on this read-only report. Even if both assets are fully funded and enabled, Hoxo must still prove the exact dual-wallet Soroban auth/signing process, safe matching evidence, replay protection and independent verification of the chain receipts. Perpetual opens remain separately disabled by canonical risk. The original Hoxo `registry/testnet.json` is not promoted by M41.
