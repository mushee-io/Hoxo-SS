# Real Stellar Testnet execution handoff after M24

**Status: SOURCE AND TEST HARNESS ONLY, NOT DEPLOYED OR APPROVED.** The exchange still has seven `null` contract IDs in `registry/testnet.json`. A green CI run, a successful network-health check or a read-only signature parser does **not** establish an actual on-chain Hoxo lifecycle. No independent security audit has been performed.

## What is newly implemented

- **M5 oracle candidate**: `contracts/oracle-adapter` is a native Soroban contract that accepts on-chain price submissions from two independently authorised immutable Testnet publisher addresses. Both must report a single market, cannot overwrite within the same ledger, use the actual ledger time, expire after 120 seconds, and must agree within 150bps. Each mark/index must agree within 200bps. Administrative pause is separate from publishers; no publisher can unpause. The oracle explicitly returns `execution_approved() == false`. A quorum of two signatures is *not* proof that its off-chain data sources are independent or economically correct.
- **Real M12 ABI exercise**: a native Soroban test imports this actual oracle crate and calls it from the perp-clearinghouse. The denying risk controller prevents live positions even with a coherent feed. This is **not Testnet deployment**; a native contract test is not a wallet-signed network transaction.
- **Operator-only Testnet CLI**: `deployment/testnet-operator.mjs` builds reviewed one-role commands; `scripts/deploy-testnet-operator.mjs` is dry-run by default. If explicitly executed, it invokes `stellar contract deploy` for one role with `--network testnet` and an **external local CLI identity alias**. No signing seeds, passwords, account secret keys, automatic funding, recovery phrases or deployed identities are stored in source.
- **M23 artifact inventory**: adds the 7th contract's compiled `hoxo_oracle_adapter.wasm` for SHA-256 inspection in CI.
- **CI**: builds the oracle WASM and runs tests on immutable publishers, stale/paused and wrong-network requests, price deviation, signing controls, candidate perp interop and no-fake-deployment rules.

## Prepare the operator's environment

A trusted operator must run a reviewed Stellar CLI on their own machine with a **distinct Testnet-only** funded signing identity they control, an approved public G-address for an admin, two *distinct* approved publisher G-addresses, and **one independently verified valueless seven-decimal token C-address** for token-escrow contracts. Do not select any real stablecoin, issuer, private network or mainnet collateral. Do not paste any private key in this project or GitHub issue.

Build all supported packages with the reviewed Rust and Stellar CLI versions:

```sh
cargo test --workspace --all-targets
stellar contract build --package hoxo-oracle-adapter
stellar contract build --package hoxo-risk-gate
stellar contract build --package hoxo-collateral-vault
stellar contract build --package hoxo-spot-settlement
stellar contract build --package hoxo-money-market
stellar contract build --package hoxo-perp-clearinghouse
stellar contract build --package hoxo-unified-margin
npm run m23:plan -- ./target/wasm32v1-none/release
```

On the **operator's own machine**, make a private non-secret configuration JSON in an ignored location outside the repo (replace example placeholders with independently checked public StrKeys, not private seeds):

```json
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "sourceAlias": "hoxo_testnet_operator",
  "adminPublicKey": "G_PUBLIC_ADMIN_ADDRESS",
  "publisherA": "G_PUBLIC_ORACLE_SOURCE_A",
  "publisherB": "G_PUBLIC_ORACLE_SOURCE_B",
  "valuelessTokenContract": "C_PUBLIC_VERIFIED_VALLUELESS_ASSET_CONTRACT",
  "marketId": 1
}
```

Stellar G/C addresses are checked for version bytes and CRC16-XModem; placeholders above will **not** pass. The `sourceAlias` must reference an externally secured funded local CLI key, never an `S...` seed or mnemonic. Ensure the admin address has a valid, independent authorisation path for contract constructors; the CLI source identity alone does not prove admin signing for different G-accounts.

Dry-run review for **one** role:

```sh
npm run testnet:deploy -- oracle-adapter /secure/path/hoxo-testnet-operator.json
```

Only after the operator confirms source, key custody, contract constructor, valueless token and network preflight should they run **one** explicit Testnet deployment; the CLI requires an interactive terminal and refuses CI:

```sh
HOXO_TESTNET_OPERATOR_ACK=I_UNDERSTAND_HOXO_TESTNET_UNAUDITED_NO_FINANCIAL_BETA \
  npm run testnet:deploy -- oracle-adapter /secure/path/hoxo-testnet-operator.json --execute
```

The other roles are `risk-engine`, `collateral-vault`, `spot-settlement`, `money-market`, `perp-clearinghouse` and `unified-margin`. Each is separately reviewed, built, operated and verified. **Do not automatically deploy all seven without checking their distinct constructors and runtime governance.** The CLI returns no fabricated deployment hash or verified contract ID; the operator must record actual evidence from Stellar RPC/explorer and independently compare installed code.

This script is intentionally unexecutable in this chat/CI without the operator-owned Testnet signer, its independent security reviews, a valueless asset issuer and explicit interactive control. Do not add its acknowledgement token as a CI secret or unattended job.

## How to verify a real deployment (no substitutions)

For each real Testnet deployment, collect **actual** source revision, CI build artifact and WASM SHA-256, canonical Testnet network passphrase, transaction hash from the signed deployment, ledger number and its independent ledger hash anchor, newly installed C-address and WASM hash, token issuer/decimals, constructor inputs, admin+publisher owners, and storage TTL. Compare **two independently operated RPC/Horizon providers** and read contract state. An RPC provider saying SUCCESS is not an independent bytecode audit. The registry may only be updated to an unapproved `candidate` after evidence is checked; no claim of approved deployment should be inferred from a candidate entry.

**Current real transaction evidence:** none. M21's receipt checker has no genuine Hoxo four-wallet sequence to verify and cannot infer economic balance changes from signed envelopes alone. Keep reporting this accurately.

## Canonical integrations still required

- **Oracle source provenance**: publisher signatures are not enough. An independent data feed, anti-manipulation economics, signer governance/rotation, market mapping, failover, controlled upgrade and external code audit are outstanding.
- **M7 risk authority**: the existing contract's `authorization_enabled()` returns false, and `authorize_trade` rejects. A production risk controller must authenticate live oracle data and authoritative collateral, all loans (including accrued interest), perps, funding, insurance, options/orders and pending reservations atomically **without relying on caller-supplied balances**.
- **M15 cross-product custody**: source contract has internally conserved reservations, but M9 spot, M11 lending and M12 perp contracts use separate escrow. The existing mocks are NOT bridge adapters. Build audited adapter-aware transactional workflows and establish a single on-chain source of asset claims, debt and liquidation rights before calling it unified margin.
- **Live M21 proof**: use at least four independent funded **Testnet-only** wallets to produce authorised valueless deposit, spot settlement, lending supply/borrow/repay, perp open/close/liquidation and withdrawals. Reconcile exact before/after assets, debt shares, funding and insurance. Do not claim success from local mocks, invented hashes or a screenshot.
- **M22 independent audit**: appoint an external qualified Soroban security team, provide reviewed exact source/WASM revision, threats and economic model, obtain signed report, remediate all high/critical findings and retest on Testnet. This cannot be substituted with internal AI/CI testing.
- **M23 public financial beta**: only open after all the above are accepted by independent reviewers, trusted controls, operator runbooks and any required legal/compliance approval. No mainnet deployment is authorised.

## Most important blockers as of this commit

| Gate | Status |
| --- | --- |
| Seven candidate contract sources / native tests | Source track in CI, candidate oracle newly added |
| Real wallet-controlled Testnet deployment | **NOT DONE** (operator identity/funding, independently validated token and security approvals absent) |
| Live oracle and canonical risk integration | **NOT DONE** (oracle source candidate only; M7 authorization remains off) |
| M15 common collateral across spot/perps/lending | **NOT DONE** |
| Verified 11-step M21 ledger and economic proof | **NOT DONE** |
| Independent M22 audit and remediation | **NOT DONE** |
| Public financial beta | **CLOSED** |
| Mainnet | **NO-GO** |

Reference: official [Stellar CLI deployment documentation](https://developers.stellar.org/docs/tools/cli/cookbook/upload-deploy). The network may upgrade/reset; always revalidate current protocol compatibility, storage TTLs and installed WASM before each deployment.


## M15 chain-backed risk change

The Testnet `risk-engine` role now maps to **`hoxo_canonical_risk.wasm`** (the original M7 `hoxo_risk_gate.wasm` remains a separate *preview-only* analytical contract). Its constructor must receive operator-verified `riskVaultContract`, `valuelessTokenContract`, `riskOracleContract`, `marketId` and a fixed bounded `maxOwnerReservedE7` of at most 1,000,000,000,000 base units (100,000 tokens). This operator config uses **public C-addresses only**, never private keys, and still requires admin authorisation.

Use the new two-stage protocol with genuine wallet permissions: `CanonicalRisk.prepare_spot_reservation(owner,id,amount_e7)` first, then `UnifiedMargin.reserve(owner,bound_adapter,Spot,id,amount_e7)` within 20 ledgers. M15's own free-token, ownership and adapter checks stay authoritative. A prior native Soroban integration test exposed a forbidden recursive call to M15, and the new permit approach removes it. The resulting contract can only reserve existing collateral; **no M9 two-token DvP, lending borrow, perp open or real M21 lifecycle** is authorised. See [M15 risk design](m15-chain-backed-risk.md).


## M9/M11/M12 custody-routing auxiliary candidate

`contracts/custody-router` now exists as an **eighth auxiliary source candidate** separate from the seven canonical Testnet registry roles, which all still have null deployed IDs. It provides atomic M15 free-quote DvP against M9 and bidirectional transfer of real 7-decimal tokens and independent claims between M15 and M11/M12. It never uses M15 collateral for leveraged borrowing/perpetual positions, and M11/M12 transfers require zero active debt/positions. The new auxiliary contract is **not** automatically added to the operator deployment registry; it must undergo security review and separate operator-managed Testnet deployment with verified immutable contract addresses, native execution evidence, and real four-wallet signing. See [custody router runbook](m15-m9-m11-m12-custody-routing.md).
