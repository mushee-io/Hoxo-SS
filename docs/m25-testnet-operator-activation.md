# M25 — operator-only Testnet activation handoff

**Release decision: NOT LIVE.** These files complete the missing **deployment command preparation and product-risk binding** for the current Hoxo source layout. No real Hoxo transaction, funded signer, audit or deployed contract address is supplied or created by this milestone. All seven canonical registry roles remain planned with null addresses, and public financial Testnet beta and mainnet remain NO-GO.

## Complete contract dependency order for the current source

The actual Hoxo current system contains seven canonical candidate roles, plus two separately deployed auxiliary contracts. The following is an **operator-reviewed proposal**; independent security review, reproducible WASM code-hash verification and public Testnet receipts must precede any application financial access.

| Step | Contract or transaction | Immutable prerequisites |
| --- | --- | --- |
| 1 | Independent valueless Testnet seven-decimal token | Reviewed contract/token address, minted Testnet test funds, external signer, proof of no mainnet assets |
| 2 | `collateral-vault` M6 | Admin G-address |
| 3 | `spot-settlement` M9 | Admin G-address; remain paused and no asset allowlist until authorisation review |
| 4 | `money-market` M11 | Admin and canonical valueless token; borrowing stays disabled |
| 5 | `perp-clearinghouse` M12 | Admin, same token and immutable market ID; retain pause |
| 6 | `unified-margin` M15 | Admin and same token; retain pause |
| 7 | `oracle-adapter` M5 | Admin, same market ID, two distinct publisher G-accounts; source authenticity must be reviewed independently |
| 8 | `portfolio-accounting` auxiliary | Actual verified M15, M11, M12 IDs, same valueless token and admin |
| 9 | `risk-engine` canonical spot-only | Verified M15, oracle, same token, market ID, owner reservation cap; **deploys paused** |
| 10 | `custody-router` auxiliary | Verified M15, M9, M11, M12, same valueless token and admin; deploys paused |
| 11 | **Operator-signed `CanonicalRisk.bind_products(portfolio,lending,perp)`** | Verified deployed contract IDs, exact admin authority, risk paused; one-time immutable and reversible only through reviewed migration |
| 12 | Independent Testnet execution lab and security review | Actual transaction hashes and before/after token/claim balances, source/WASM hashes, Soroban budget and TTL tests, independent audit findings and fixes |

There is intentionally **no automatic unpause/borrow/perp-open** in this script. The real owner-account M15 spot reservation can only be activated following the separate audits and signed-transaction acceptance; shared leveraged borrowing/perps remain hard-disabled in the current risk contracts.

## Secure external public configuration

Use a private file **outside the GitHub repository**, containing only public Stellar Testnet G/C addresses and an external locally managed CLI identity alias. **Never store or paste seed phrases, S-addresses, recovery phrases, passwords or secret API keys in this JSON.**

```json
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "sourceAlias": "hoxo_operator_external",
  "adminPublicKey": "G_PUBLIC_ADMIN",
  "publisherA": "G_PUBLIC_ORACLE_A",
  "publisherB": "G_PUBLIC_ORACLE_B",
  "marketId": 1,
  "maxOwnerReservedE7": 500000000,
  "valuelessTokenContract": "C_REVIEWED_TEST_ONLY_TOKEN",
  "riskVaultContract": "C_VERIFIED_M15",
  "riskOracleContract": "C_VERIFIED_ORACLE",
  "spotSettlementContract": "C_VERIFIED_M9",
  "moneyMarketContract": "C_VERIFIED_M11",
  "perpClearinghouseContract": "C_VERIFIED_M12",
  "portfolioAccountingContract": "C_VERIFIED_PORTFOLIO",
  "riskEngineContract": "C_VERIFIED_CANONICAL_RISK"
}
```

**These are placeholders, not usable StrKeys.** Each role can only be deployed once its own public prerequisites have been independently obtained and verified. The source alias must resolve to a trusted, funded local Testnet signing identity and must be authorised for the exact `adminPublicKey` used in constructors/invocations. A valid-looking G or C address is **not evidence** a contract is deployed or corresponds to reviewed code.

## Commands

After reviewing/building the source and inspecting all native Soroban test results:

```sh
cargo test --workspace --all-targets
stellar contract build --package hoxo-portfolio-accounting
stellar contract build --package hoxo-custody-router
stellar contract build --package hoxo-canonical-risk
npm test
npm run check:readiness
```

For each candidate, review the **dry run** first. For example:

```sh
npm run testnet:deploy -- portfolio-accounting /secure/public-hoxo-testnet.json
npm run testnet:deploy -- custody-router /secure/public-hoxo-testnet.json
npm run testnet:deploy -- risk-engine /secure/public-hoxo-testnet.json
npm run testnet:bind-risk -- /secure/public-hoxo-testnet.json
```

The only way the included operator script attempts an actual submitted binding is on an **authorised operator's interactive local machine**, with reviewed public addresses and secure local signer:

```sh
HOXO_TESTNET_OPERATOR_ACK=I_UNDERSTAND_HOXO_TESTNET_UNAUDITED_NO_FINANCIAL_BETA \
  npm run testnet:bind-risk -- /secure/public-hoxo-testnet.json --execute
```

`--execute` is never enabled by CI, automation or the default CLI path. The binding command explicitly requests `stellar contract invoke --send=yes`. It is not a trading call. Do not use `--execute` until an operator independently confirms the contract is paused, all constructor metadata and code hashes match reviewed source and the local identity is fully authorised.

## Independently verified evidence still needed

For **every** deploy and binding, collect actual signed transaction hash, ledger, result code, network passphrase, on-chain C-address, exact constructor args and admin, installed WASM code hash, source revision, token decimals, price publisher independence and pre-/post-operation on-chain balances.

Run independent genuine signed Testnet actions for token issuance, allowance, deposit/withdraw, two-party M9 DvP, M11 share supply/redeem, M12 collateral handoff, M15 protected reservation and keeper liquidation in a bounded valueless sandbox. Verify replays, stale prices, partial/full liquidations, rent/TTLs, maximum 64-position budget, failure rollback, user withdrawal on pause and incorrect network rejection. Tests using `e.mock_all_auths()` prove source behavior **only**, not signatures or deployed contract safety.

An external smart-contract/economic review must audit the exact deployment source and WASM, critical/high findings must be addressed, and governance/legal/risk owners must separately approve actual trading. **Do not use real USDC, mainnet assets, real deposits, public leverage, or automated financial beta based only on this M25 deploy handoff.**

## What this milestone delivered and did not deliver

**Delivered:** updated operator package inventory (7 canonical + 2 auxiliary), verified public-address constructor argument generation for both auxiliary roles, exact one-time M15 risk product-binding preparation, operator-only signed Testnet CLI execution hooks, TTY/CI/network/acknowledgement guards, deterministic tests and documentation.

**Not delivered:** operator credentials, publicly deployed contracts, complete production-grade cross-product liquidation waterfall, real financial transaction receipts, independent audit, signed governance approval or live Hoxo trading. **Public financial beta CLOSED, mainnet NO-GO.**


### Subsequent M26 read-only contract-bytecode check

The new `npm run testnet:verify-code` command compares locally reviewed WASM with the actual code fetched from public Stellar Testnet RPC at each candidate C-address. It also checks a supplied transaction hash and prevents mismatched builds and wrong-network responses from being treated as proof. It never submits transactions or updates the registry. Code matching alone does **not** prove the transaction created that C-address or validate its constructor and admin. The result deliberately stays `deploymentProven:false`, `financialBetaAuthorized:false`, and `realTradingVerified:false`. See [M26 review notes](m26-real-testnet-contract-proof.md).
