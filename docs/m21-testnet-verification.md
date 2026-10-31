# M21 — End-to-end Stellar Testnet verification (evidence foundation)

**Implementation:** read-only transaction receipt, ledger and signed wallet-envelope checker built. **Lifecycle status: BLOCKED / NOT VERIFIED.** No Hoxo contract is deployed or independently code-verified as of this milestone's source state. Do not equate successful software tests with on-chain deposits, perpetuals, interest, liquidations or cross-product unified margin.

## Goals and explicit limitations

M21's ultimate acceptance gate is a genuinely funded **Stellar Testnet** lifecycle with multiple independent wallets: deposit → bilateral spot settlement → lending supply → borrow → perp escrow deposit/open → liquidation → repay → return/withdraw. Every accepted state transition needs a signed transaction hash, a verified deployed contract, current canonical risk/oracle authority, independent RPC receipts, financial state/asset deltas and a solvency proof. Negative tests must cover replay, paused contracts, stale oracle, unauthorized signer, shortfall, network reset and recovery.

The current M6 vault, M9 spot, M10–M11 lending and M12–M14 perps use **isolated contract custody**. M15 reservation ledger is **not wired** to these product contracts. Therefore even valid individual receipts will not prove the intended **unified-margin end-to-end cycle**. The M19 indexer stores candidate provider-reported events only; it does not decode or reconcile canonical financial state.

## Implemented M21 proof checker

- Strict Testnet passphrase and schema; rejects extra/missing manifest fields, reused transaction hashes, duplicate G-address wallet roles, missing contract-role candidates and reordered steps.
- Requires **four independent wallet identities**: maker, taker, borrower and keeper. No key material enters the manifest.
- Obtains canonical Stellar Testnet RPC health/network/head and queries **getTransaction** for each submitted hash, requires SUCCESS, raw envelope/result/meta XDR, the announced transaction hash and a matching ledger anchor from **getLedgers** within retention.
- Uses pinned official Stellar SDK to recompute the transaction hash for the exact Testnet network, cryptographically verify its expected G-account Ed25519 envelope signature, and check the **single** Soroban invoke contract ID and function name. A separate CI job tests this using locally signed test-envelope XDR.
- Requires monotonically ordered ledger sequences, non-replayed hashes, and candidate deployment ledger metadata. **The ledger/RPC responses remain provider claims**, not independent consensus verification.
- Produces an explicit `PARTIAL_RECEIPT_EVIDENCE_NOT_END_TO_END_VERIFIED` status even if every submitted receipt passes these limited checks. It never marks asset deltas, Soroban non-invoker auth, bytecode, actual debt, PnL, accrued funding, insurance payouts or unified margin verified.
- The CLI uses only `getNetwork`, `getHealth`, `getLatestLedger`, `getTransaction` and `getLedgers`. It NEVER calls sendTransaction or reads signing secrets. The default command makes **no RPC calls**.

## Commands

Check current blockers without keys or RPC requests:

    npm run m21:readiness

After independently deploying and documenting the contracts in the strict candidate registry, gather **real** Testnet transaction hashes into an **external**, untracked evidence manifest. Verify it:

    npm install --ignore-scripts
    npm run m21:verify -- /secure/path/m21-transaction-evidence.json

To test code without real funds or contract deployments:

    npm run test:m21
    npm test
    npm run check:readiness

## External evidence manifest format

Only actual Testnet wallet addresses and actual confirmed transaction hashes are allowed; the values below describe the schema, **not usable evidence**.

    {
      "schemaVersion": 1,
      "networkPassphrase": "Test SDF Network ; September 2015",
      "wallets": {
        "maker": "REAL_MAKER_G_ADDRESS",
        "taker": "REAL_TAKER_G_ADDRESS",
        "borrower": "REAL_BORROWER_G_ADDRESS",
        "keeper": "REAL_KEEPER_G_ADDRESS"
      },
      "steps": [
        {"id":"vault-deposit","transactionHash":"REAL_TX_HASH_01"},
        {"id":"spot-settle","transactionHash":"REAL_TX_HASH_02"},
        {"id":"lending-supply","transactionHash":"REAL_TX_HASH_03"},
        {"id":"lending-borrow","transactionHash":"REAL_TX_HASH_04"},
        {"id":"perp-deposit","transactionHash":"REAL_TX_HASH_05"},
        {"id":"perp-open","transactionHash":"REAL_TX_HASH_06"},
        {"id":"perp-liquidate","transactionHash":"REAL_TX_HASH_07"},
        {"id":"lending-repay","transactionHash":"REAL_TX_HASH_08"},
        {"id":"perp-withdraw","transactionHash":"REAL_TX_HASH_09"},
        {"id":"lending-withdraw","transactionHash":"REAL_TX_HASH_10"},
        {"id":"vault-withdraw","transactionHash":"REAL_TX_HASH_11"}
      ]
    }

The manifest must be retained outside the repo and contain **no secret seeds, signatures, keys, passwords, API tokens or transaction signing instructions**. Some genuine flows may require distinct funding, allowance, approval, guardian or repay transactions beyond the eleven lifecycle observations. A provider's successful receipt does not establish multi-signature Soroban authorization for every participant or legitimate token transfer/state delta.

## Deployment and acceptance blockers — do NOT skip

1. Build, independently review, deploy and check the actual Testnet code hash for the asset token, M5 canonical oracle, M7 risk authority, M6, M9, M11, M12/M14 and M15 contracts. Do not trust a registry entry by itself; code hashes, upgrade/admin roles, TTL and network-reset status need independent review.
2. Approve only a **valueless** Testnet collateral token with a valid issuer and 7-decimal token contract. Never imply a real USDC market/issuer without verification.
3. Secure **four independently owned and funded Testnet wallets**. Sign with user/operator-held wallets; do not put private keys in CI, GitHub issues, artifacts or an API. Separate keeper and oracle identities; demand review of deployment owner rights.
4. Validate each contract's pause states, controller bindings, actual signed receipts, per-wallet pre/post balances and exact on-chain accounting across the complete supply/borrow/perp/liquidate/repay cycle. Establish instrument- and collateral-level solvency, correct interest/funding and no fabricated volume.
5. Integrate M15 with M6/M9/M11/M12 before claiming **unified margin**. Current contracts are independently escrowed; this is a hard functional gap, not just a missing dashboard.
6. Obtain independent M22 audit, fault injection, oracle outage/recovery drills, protocol/network upgrade revalidation, archived TTL recovery, and responsible disclosure before public beta.

## Next engineering priorities

The immediate dependency is real deployment and contract linkage rather than frontend functionality. M21's read-only evidence gates can be run as soon as genuine receipts exist, but **cannot** make Hoxo financially operational in isolation. The separate M22 audit and M23 public-beta gates remain unpassed.

Official API reference for the limited RPC receipt checks: Stellar developer documentation for getTransaction, getLedgers and getHealth. The getTransaction endpoint has a bounded retention window; a missing old receipt must be treated as unverified, never fabricated.
