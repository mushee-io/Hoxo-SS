# M4 — Stellar Testnet infrastructure

**Scope:** Read-only, fail-closed network readiness checks and canonical configuration for Hoxo-SS. **Network verification is never proof that Hoxo exchange markets, positions, money markets, margin or contracts are deployed.**

## What M4 builds

- `config/testnet.mjs` supplies the immutable Testnet passphrase and public default Horizon/RPC/Friendbot URLs. The CLI supports `HOXO_TESTNET_HORIZON_URL` and `HOXO_TESTNET_RPC_URL` overrides for third-party HTTPS providers. Mainnet/Futurenet hosts, local HTTP services and URLs containing credentials/query strings are rejected. Any allowed provider still must prove the Testnet passphrase.
- `infra/network.mjs` fetches Horizon and Stellar RPC independently. RPC uses `getNetwork`, `getHealth` and `getLatestLedger` with explicit JSON-RPC 2.0 envelopes and timeouts; rejects stale/malformed ledgers, degraded nodes, wrong networks or ledger lag above 24.
- `registry/testnet.json` contains only canonical native XLM as an existing asset and **six planned contract roles with null contract IDs**. There is NO claimed or fabricated token issuer, deployment, smart-contract ID, WASM hash, transaction, TVL or trading volume.
- `infra/registry.mjs` enforces strict Testnet-only registry schema. If future contract metadata is entered it is treated as `candidate` (not verified) until independently checked on-chain. Wrong network, invalid account/contract StrKeys or fake `deployed` states are rejected.
- `app/#network` presents the independent Horizon, RPC and contract-registry statuses, network-ledger alignment and a clear warning that no Hoxo contracts exist yet.
- `scripts/check-infra.mjs`, `scripts/check-registry.mjs` and CI verify these gates.

## Run locally

```sh
npm test
npm run check:registry
npm run check:infra
```

To use an alternate **HTTPS Testnet** provider:

```sh
HOXO_TESTNET_RPC_URL=https://your-testnet-rpc-provider.example npm run check:infra
```

Custom providers are not trusted by hostname alone: `getNetwork` must return `Test SDF Network ; September 2015`. All checks are read-only. A transient public service outage makes the live CI job fail rather than declaring readiness.

## Deployments and registry policies

- Do not populate a `C...` contract ID in the registry without a genuine Stellar Testnet deployment and transaction hash, and separately proving the contract instance on-chain. Registry-only entries are **unverified candidates**.
- Future deployment instructions: build audited Soroban WASM, deploy using `stellar contract deploy --network testnet --source-account <testnet account> --wasm <path>`, then verify the contract instance and record the canonical ledger/tx before enabling capabilities. This step belongs to M6+ and **has not happened**.
- After any Stellar Testnet reset, reverify all accounts, assets and contracts and clear stale deployment metadata; never reuse old Testnet addresses as proof.
- Friendbot remains a user-confirmed action in M3; it may fund valueless XLM accounts, but it is not an asset issuer or contract deployer.
- Backend signing, RPC transaction simulation, fee payments, exchange execution and untrusted issuer assets are not M4 features.

## Acceptance gates

1. Deterministic unit tests verify correct Testnet passphrase, JSON-RPC methods, ledger consistency, rejection of stale/mismatched responses and strict registry.
2. CI's live Testnet job independently contacts the genuine SDF public RPC and Horizon. Network downtime reports a failed check, not a green badge.
3. Chromium tests open `/app/?market=xlm-usdc-spot#network`, confirm the registry shows zero verified contracts and ensure the disabled trade/deposit controls remain disabled.
4. Hosted browser and actual Freighter acceptance remain pending due to existing Vercel project creation HTTP 403. No user funds have been moved.

## Verification result — 31 October 2026

[GitHub Actions run 41189342330](https://github.com/mushee-io/Hoxo-SS/actions/runs/41189342330) completed successfully with **four passing jobs**: 51/51 unit/integration tests, 8/8 headless Chromium tests, Horizon Testnet smoke, and read-only RPC/Horizon/registry verification. The live infrastructure job observed Horizon ledger **5,483,142** and Stellar RPC ledger **5,483,143** (lag 1, within tolerance) with exact Testnet passphrase and healthy RPC. These are a **point-in-time** check, not a claim of ongoing uptime or contract deployment.

M4 code and automated tests are complete. Hosted visual verification still requires permission to create/deploy the Vercel project (previous HTTP 403). M3 real Freighter extension acceptance also remains pending. All six Hoxo contract roles are still marked **planned** with no contract IDs.
