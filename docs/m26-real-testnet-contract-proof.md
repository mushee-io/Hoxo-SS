# M26 — read-only real Stellar Testnet contract-code verification

**Status: source-level verifier added. The repository's seven canonical Hoxo contract IDs are still null. No actual Hoxo deployment, real signed trade or trading activation is claimed.**

## Why this matters

Successful native Soroban tests and GitHub Actions results do not prove that the exact audited WASM is deployed at any given Stellar Testnet C-address. Even a plausible C-address or transaction hash is not reliable evidence on its own.

The new verifier retrieves the **on-chain executable WASM bytes** associated with the supplied contract ID via the pinned official Stellar JavaScript SDK. It computes SHA-256 of that bytecode and compares it with a locally reviewed WASM artifact generated from the source revision you intend to use. If either hash differs, the verifier rejects the claimed match.

Before reading contract code it requires a healthy, fresh Stellar Testnet RPC node and the exact canonical Testnet passphrase. It also checks that the supplied transaction hash is reported as successful in a valid ledger. It does not sign, broadcast, read secrets, change paused state or modify the canonical registry.

**Important limitation:** This does not cryptographically prove that the submitted transaction actually created the provided C-address. It separately validates current on-chain executable bytes and an RPC-reported successful transaction. Constructor identity, signer, ownership, tx-to-contract linkage, contract risk configuration, and audit approval are not established by these checks. The result deliberately reports deploymentProven=false and realTradingVerified=false even when hashes match.

## Operator usage

Build the nine Hoxo WASM packages from a reviewed source revision. Create an external public-only JSON manifest using **actual** contract IDs and actual transaction hashes from deployment, not the examples below.

```json
{
  "schemaVersion": 1,
  "networkPassphrase": "Test SDF Network ; September 2015",
  "contracts": [
    {
      "role": "spot-settlement",
      "contractId": "C_ACTUAL_VERIFIED_STELLAR_TESTNET_CONTRACT",
      "deploymentTxHash": "ACTUAL_64_HEX_DEPLOYMENT_TRANSACTION_HASH"
    }
  ]
}
```

The placeholders above are deliberately invalid and will be rejected. You can submit one to nine roles. Duplicate contract addresses, roles or hashes are rejected. The code looks up the exact corresponding locally compiled WASM filename for each role.

```sh
npm ci
npm run test:testnet-proof
npm run testnet:verify-code -- /private/public-hoxo-testnet-receipts.json ./target/wasm32v1-none/release
```

Files must be regular, bounded non-symlink WASM artifacts with correct headers. No mainnet or futurenet endpoint is accepted. The command is **read-only** and uses only public transaction hashes and contract addresses.

## What is still needed for actual Testnet trading

1. An actual independently funded, authorised Stellar Testnet operator identity and an independently verified valueless 7-decimal asset, supplied on the operator's machine only. Never post an S-address, signing seed or recovery phrase.
2. Reviewed operator deployments for M9/M11/M12/M15, canonical risk, oracle, portfolio accounting and custody router, using the order in [M25](m25-testnet-operator-activation.md), with actual network transaction receipts.
3. Complete transaction-to-contract XDR linkage, verified constructor/admin permissions, reviewed deployed code, and genuine two-party wallet signatures for the M9 settlement.
4. Real ledger-confirmed Testnet deposits, trades, lending and perpetual collateral transactions, including account before-and-after financial state and independently reproducible receipt evidence.
5. Independent smart-contract/economic security audit and explicitly approved risk, user beta and mainnet release gates. Shared M15 borrowing against M11 debt or M12 perpetual positions is still not authorised by canonical on-chain risk.

**Current launch determination: public financial Testnet beta CLOSED, mainnet NO-GO.**