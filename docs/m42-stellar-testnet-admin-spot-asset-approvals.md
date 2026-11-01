# M42 — Wallet 1 approval of the two Stellar Testnet spot assets

**Operator handoff only; never a trading activation.** This document specifies two independently signed admin calls on the deployed **M9 spot-settlement contract**. The repository and CI must not sign, broadcast, enable swap execution, change the paused flag, or claim settled trading volume.

## Evidence and fixed scope

The live M41 read-only probe verifies the code and admin identity for the current deployed candidate. [M41 workflow](https://github.com/mushee-io/Hoxo-SS/actions/workflows/m41-spot-assets.yml) can recheck it immediately before any admin signature; do not rely on a historical result alone.

| Role | Expected exact value |
| --- | --- |
| Network | **Stellar Testnet**; passphrase `Test SDF Network ; September 2015` |
| M9 contract | `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF` |
| Contract admin **and required Freighter signer** | `GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB` |
| Allowlisted XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Allowlisted Circle **Testnet** USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Circle **Testnet** USDC issuer (reference only, **not** the `asset` input) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Expected deployed WASM SHA256 | `916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3` |

The Rust contract's exact admin operation is `set_asset(asset: Address, enabled: bool)`, and it checks `admin.require_auth()`. Enabling the token allowlist while the contract remains paused **does not** enable `settle`; `set_pause` is a separate method. Both SACs expose **7 decimals**, confirmed by M41.

## Required read-only preflight

1. Open the [M41 GitHub Actions workflow](https://github.com/mushee-io/Hoxo-SS/actions/workflows/m41-spot-assets.yml) and manually run it on `main`, or run `npm run check:spot-assets` on a reviewed checkout. Open the **Live Stellar Testnet (READ ONLY...)** job log; a green GitHub job alone does not prove trading readiness because business blockers do not make the workflow fail.
2. Require `wasmHashVerified: true`, `ownerVerified: true`, `contractPaused: true`, the correct network and listed contract/SAC IDs, both tokens reporting seven decimals, and wallet trustlines authorized. Check available wallet XLM for fees.
3. Check `baseAllowed` and `quoteAllowed`. **If one is already true, don't blindly resubmit that approval.** If the network, admin, code hash or pause status diverges, stop. No remote or automated admin signing.

## First wallet-signed call — approve native XLM

1. In Freighter choose the account ending **RHDB** and verify **Testnet**.
2. Open the official [Stellar Lab](https://lab.stellar.org/) with **Testnet** selected; go to **Smart contracts → Contract explorer**. Load the exact M9 contract ID above.
3. Under **Invoke contract** select `set_asset`. Enter:
   - `asset` (**Address**): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
   - `enabled` (**bool**): `true`
4. Preview/simulate. Verify destination contract ID, method, typed argument values, source/admin wallet and Testnet network. Abort if there are any additional unexpected operations, authorizations, assets, transfers or methods.
5. **Only the account owner** may approve the transaction in Freighter and submit it. Share only the public transaction hash; no secret seed, recovery phrase, private key, or exported signer data.
6. Confirm transaction **SUCCESS** on Stellar Testnet and rerun M41; expect `baseAllowed: true`, still `quoteAllowed: false` if previously false, and `contractPaused: true`.

## Second wallet-signed call — approve Circle Testnet USDC

Perform the same review using a **new** `set_asset` call:
- `asset` (**Address**): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- `enabled` (**bool**): `true`

**Do not input the classic USDC issuer G-address in the `asset` argument.** M9 expects the USDC's **Stellar Asset Contract C-address**.

Sign with the same exact **admin Wallet 1** and submit. Confirm SUCCESS, then rerun M41; require `baseAllowed: true`, `quoteAllowed: true`, and still **`contractPaused: true`**. Preserve both public transaction hashes and ledgers as evidence. Fail or halt if any expected status is missing.

## Explicit stop line

**DO NOT invoke `set_pause(false)` or `settle` in this step.** Approving two assets is not acceptance of live spot trading. The separate browser/Freighter two-party Soroban auth-entry signing path, independently controlled wallet consent, exact MatchTerms verification, replay protection, wallet balance before/after reconciliation, on-chain M9 receipt and independent security review remain outstanding. The old Node-only two-secret operator CLI is not a substitute for Freighter-only signing and should not be used with the user's extension seed.

Keep perpetuals, leverage, money markets, unified margin, public beta, and mainnet disabled. The M41 workflow intentionally always reports `tradingEnabled:false`, `executePermitted:false`, `realSignedTradeVerified:false` and `confirmedVolumeE7:"0"`.

References: [M9 source](../contracts/spot-settlement/src/lib.rs), [M41 on-chain probe](../activation/m41-spot-asset-readiness.mjs), [M41 Freighter handoff](m41-live-spot-token-handoff.md), and [M9 wallet operator](m9-wallet-operator.md).
