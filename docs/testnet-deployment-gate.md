# Deployment acceptance gate — Hoxo-SS Stellar Testnet

**Status:** source implemented, native Soroban contract tests successful; **deployment not performed**. Never accept read-only Horizon/RPC verification or a UI screenshot as deployment evidence.

## Prerequisites
- A reviewed and funded Stellar **Testnet** operator account and admin address, managed through external secure key storage; never commit seeds or secret keys.
- Stellar CLI **major version >= Soroban SDK major 29**. The published CLI 28.1.0 cannot be asserted compatible with SDK29 builds by the official SDK guidance.
- Rust >=1.84 with `wasm32v1-none` target, audit-approved contract build configuration and reproducible dependency lock.
- A dedicated valueless test asset with issuer and token contract address independently verified on Stellar Testnet; do not assume USDC or BTC exists at a given issuer.
- A permanent storage TTL keeper/archival runbook for per-user balances, totals and allowlist records. Without it, a long-inactive balance can become archived.

## Required evidence before enabling deposits

1. Run `cargo test --workspace --all-targets` and sign off outstanding invariants and audit findings.
2. With a compatible CLI, run `stellar contract build`; record final WASM checksum and size, source revision, CLI version, and `Cargo.lock`.
3. Use only `--network testnet` and an approved operator identity. Invoke constructor with authorised admin. Do not deploy a contract with an unowned, disposable admin key.
4. Fetch the transaction receipt and finalised ledger, verify its success and independently query the contract instance via Stellar RPC.
5. Register the resulting valid `C...` contract ID as **candidate** in `registry/testnet.json`, with actual deployment hash/ledger; the registry does not assert on-chain verification by itself.
6. With two independent wallets, sign deposits, read the canonical on-chain per-account balance, withdraw part and all, then test overdrawal, pause, delisting, an unauthorised signer and a failed token transfer. Capture receipt hashes.
7. Confirm a user can withdraw while deposits are paused, and confirm vault token balance covers all outstanding recorded claims.
8. Rehearse storage TTL renewals, archiving and restoration without losing legitimate account entitlements, under independent review.
9. Only after an audited M5 oracle and M7 canonical risk authority exist should the collateral vault be integrated with leveraged trading or money markets.
10. Keep app-side deposit and trading buttons disabled until independent Testnet verification and the separate M9 settlement gate pass.

**Network change warning:** The planned Bell/Protocol 30 Testnet upgrade vote is 3 November 2026, 17:00 UTC. Repeat deployment assumptions after that vote, particularly SDK/CLI and address-format compatibility.
