# Deployment acceptance gate — Hoxo-SS Stellar Testnet

**Status:** source implemented, native Soroban contract tests successful; **deployment not performed**. Never accept read-only Horizon/RPC verification or a UI screenshot as deployment evidence.

## Prerequisites
- A reviewed and funded Stellar **Testnet** operator account and admin address, managed through external secure key storage; never commit seeds or secret keys.
- Official Stellar CLI version **at least 25.2.0** is required by Soroban SDK build scripts; current CI uses pinned `stellar/stellar-cli@v28.1.0` and must pass a real `stellar contract build` against SDK 29.0.1 before compatibility is considered verified.
- Rust >=1.84 with `wasm32v1-none` target, audit-approved contract build configuration and reproducible dependency lock.
- A dedicated valueless test asset with issuer and token contract address independently verified on Stellar Testnet; do not assume USDC or BTC exists at a given issuer.
- A permanent storage TTL keeper/archival runbook for per-user balances, totals and allowlist records. Without it, a long-inactive balance can become archived.

## Required evidence before enabling deposits

1. Run `cargo test --workspace --all-targets` and sign off outstanding invariants and audit findings.
2. With a compatible CLI, run `stellar contract build --package hoxo-spot-settlement`; record final WASM checksum and size, source revision, CLI version, and `Cargo.lock`.
3. Use only `--network testnet` and an approved operator identity. Invoke constructor with authorised admin. Do not deploy a contract with an unowned, disposable admin key.
4. Fetch the transaction receipt and finalised ledger, verify its success and independently query the contract instance via Stellar RPC.
5. Register the resulting valid `C...` contract ID as **candidate** in `registry/testnet.json`, with actual deployment hash/ledger; the registry does not assert on-chain verification by itself.
6. With two independent wallets, sign deposits, read the canonical on-chain per-account balance, withdraw part and all, then test overdrawal, pause, delisting, an unauthorised signer and a failed token transfer. Capture receipt hashes.
7. Confirm a user can withdraw while deposits are paused, and confirm vault token balance covers all outstanding recorded claims.
8. Rehearse storage TTL renewals, archiving and restoration without losing legitimate account entitlements, under independent review.
9. Only after an audited M5 oracle and M7 canonical risk authority exist should the collateral vault be integrated with leveraged trading or money markets.
10. Keep app-side deposit and trading buttons disabled until independent Testnet verification and the separate M9 settlement gate pass.

**Network change warning:** The planned Bell/Protocol 30 Testnet upgrade vote is 3 November 2026, 17:00 UTC. Repeat deployment assumptions after that vote, particularly SDK/CLI and address-format compatibility.

## M9 spot settlement deployment acceptance (not yet performed)

M9 source code is a bilateral *wallet-to-wallet* atomic swap, deliberately independent of M6 custody and M7 margin. It is Testnet-locked using `SHA256("Test SDF Network ; September 2015")`. To accept a real Testnet settlement, additionally verify both authorised Stellar accounts, both approved 7-decimal token contract IDs and the exact `MatchTerms` signed by both wallets. Record the successful Soroban transaction hash, ledger, contract event, token deltas and persistent receipt; attempt replay and expired-settlement transactions and confirm failure. M8's matching signatures must **not** be interpreted as Soroban spending authorisations. Release M9 only with an audited M8 matching-to-settlement bridge and independently tested on-chain permissioning.

## M9 compiled artifact evidence

[CI 41193442596](https://github.com/mushee-io/Hoxo-SS/actions/runs/41193442596) created a 9,574-byte M9 WASM using official `stellar contract build` (CLI 28.1.0), with SHA-256 `916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3`. Its review-only artifact is available from the CI run. Building WASM does not deploy or prove bilateral account authorisations. Use a fresh CLI/SDK compatibility review after the Testnet upgrade vote, then establish actual transaction receipts before updating the registry.


### Operator deployment execution track

`npm run testnet:deploy` now builds explicit seven-role Stellar Testnet commands. Real on-chain deployments require an interactive operator with an externally managed signer, an explicit acknowledgement and independent Testnet network verification. No private keys or registry modifications occur automatically. See [Testnet execution handoff](testnet-execution-handoff.md).
