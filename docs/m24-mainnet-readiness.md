# M24 — Mainnet readiness, governance and launch controls

**Status: NO-GO. Source-level readiness framework implemented; neither mainnet deployment nor a mainnet launch is authorised.** All seven canonical Hoxo Stellar Testnet contract roles still have `null` deployed addresses. M21 does not have genuine reconciled wallet-and-contract transactions, M22 is not independently audited, and M23's financial Testnet beta remains closed. Never interpret passing M24 tests as qualified financial-system approval.

## Explicit release principle

There are three separate outcomes:
1. **Source readiness**: unit tests, risk-budget scenario calculations, artifact hashes and offline incident checklists pass. This is what this milestone builds.
2. **Verified external readiness**: independently sourced and authenticated deployed bytecode/owners, realistic multi-wallet Testnet economics, resolved external audit findings, legal and governance approvals, funded liquidity/insurance, proven SRE/recovery and recorded public beta acceptance.
3. **Mainnet launch**: a **new, separately authorised go/no-go decision** and staged deployment transaction flow, with human-held signing keys, after all evidence and formal approvals. **There is deliberately no automated step from (1) to (3).**

The code never treats a JSON `approved:true`, a source hash, a PDF file or a green CI badge as a valid auditor/committee signature or deployed contract.

## Tools built in this milestone

| Command | Action | Mainnet or funds touched? |
| --- | --- | --- |
| `npm run m24:readiness` | Show 12 release-blocking criteria and unresolved M21/M22/M23 | No |
| `npm run m24:readiness -- --require-go` | Assert that the launch gate remains blocked; **expected non-zero** | No |
| `HOXO_SOURCE_COMMIT=<40-char git commit> npm run m24:evidence -- /secure/evidence` | Hash specific external audit, governance, financial and runbook files; report missing items | No |
| `npm run m24:risk -- /secure/proposed-risk-parameters.json` | Conservative local bigint stress calculations of **unverified** proposals; non-zero when local budget breached | No |
| `npm run m24:drill -- oracle_stale` | Render unexecuted incident decision/runbook steps (six scenario choices) | No |
| `npm test` / `npm run test:m24` | Test negative controls and risk/inventory scenarios | No |

The incident scenarios are: `oracle_stale`, `rpc_fork`, `custody_deficit`, `signer_compromise`, `liquidation_failure` and `upgrade_mismatch`. The drill explicitly distinguishes operator tabletop actions from actual on-chain guardian transactions.

## Required release evidence

The default evidence directory is **outside this Git repository**. Never commit client information, seeds, credentials, private audit details, custody signing material or non-public compliance records.

The SHA-256 inventory expects:

| Filename | Independent evidence required |
| --- | --- |
| `audit-report.pdf` | Third-party contract/economic security audit with exact source and WASM scope |
| `audit-remediation.pdf` | Independently reviewed fixes for critical/high issues |
| `testnet-deployments.json` | Actual canonical audited Testnet contract IDs, code hashes, admin roles and ledger receipts |
| `testnet-lifecycle.json` | M21 independently verified wallet signatures, contract state deltas, solvency and replay evidence |
| `risk-committee.pdf` | Approved collateral factors, leverage, debt, oracle freshness, liquidation and insurance parameters |
| `liquidity-treasury.pdf` | Verified funding sources, market-maker obligations and independently reserved insurance capacity |
| `governance-keys.pdf` | Verified authorisations for distinct hardware-backed key holders, reviewed multisig thresholds and timelocks |
| `legal-compliance.pdf` | Qualified jurisdiction-specific review of credit, derivatives, payments, sanctions and consumer obligations |
| `mainnet-ops.md` | Monitored SLOs, contract addresses, rollback/governance ownership and incident runbooks |
| `incident-rehearsal.json` | Actual reviewed on-chain halt/restore and recovery receipts—not the local M24 tabletop output |
| `public-beta-report.pdf` | Successful, independently verified, valueless M23 Testnet financial beta closeout |
| `launch-go-no-go.pdf` | Signed independent governance and release-board approval of the exact source/build/deployment parameters |

**Present files are labelled `HASHED_NOT_INDEPENDENTLY_REVIEWED`; they are not marked verified.** SHA-256 hashes identify local bytes; they do not attest to authorship, signature, security or that actual transactions happened. The inventory itself is only a deterministic source-to-packet reference.

The official Stellar public network is different from Testnet. All earlier scripts here use Stellar Testnet; no M24 tool signs, funds, deploys, reads mainnet positions or broadcasts a public-network transaction. Do not switch `--network` by editing scripts without security and governance review.

## Local economic risk proposal

The evaluator requires decimal strings for all USD amounts and integers for basis-point and freshness values. It computes:

`stressed equity = collateral × (1 − collateral shock) − debt − projected losses − required open-interest margin`

and checks the global collateral, borrow, open interest, per-account exposure, insurance coverage and stale-oracle conditions. Losses and required reserves round conservatively. **This is a simplified tabletop budget, not contract-authoritative margin modelling or permission to list an asset.**

Example proposal (**illustrative numbers only; not committee-approved**):

```json
{
  "totalCollateralUsd":"1000",
  "outstandingDebtUsd":"100",
  "openInterestUsd":"200",
  "insuranceReserveUsd":"100",
  "projectedStressLossUsd":"10",
  "singleAccountExposureUsd":"25",
  "maxCollateralUsd":"1000000",
  "maxDebtUsd":"1000000",
  "maxOpenInterestUsd":"1000000",
  "maxSingleAccountExposureUsd":"1000000",
  "collateralShockBps":1000,
  "openInterestMarginBps":1000,
  "minimumInsuranceCoverageBps":10000,
  "maximumOracleAgeSeconds":60,
  "observedOracleAgeSeconds":20
}
```

Even when local inputs pass, the output state is `LOCAL_PROPOSAL_WITHIN_DECLARED_BOUNDS_NOT_APPROVED` with `financialLaunchPermitted:false`. In particular, this model **does not check authenticated live oracle readings**, non-supplied cross-margin liabilities, token conservation, security or legal authorisations. Actual collateral assets and leverage ratios must be independently calibrated, audited and approved.

## Governance and liquidity pre-launch review

- **Governance:** assign distinct signer roles, minimum independent multisig threshold, verifiable access removal, incident guardian and key-recovery process; approvals must refer to the same reviewed WASM/source and timelocked permissions.
- **Risk:** approved asset issuer allowlist, audited oracle, collateral haircut, isolated/portfolio margin, per-account exposure, borrow interest/funding, liquidation throughput, stop-market design and leverage.
- **Liquidity:** finance real (not fabricated) initial order-book depth and redemption liquidity, verify quote and settlement asset custody, measure market-maker concentration and adverse stress, confirm insurance buffer and loss waterfall.
- **Compliance:** seek qualified jurisdictional advice before soliciting deposits or derivatives users. Testnet valueless gas use does not establish regulatory permission to offer financial services.
- **Security:** no unresolved critical/high issues or unverified upgrades, least-privileged operators, monitored RPCs, immutable receipts and evidence of on-chain emergency controls.
- **Operations:** on-call coverage, preflight SLOs, incident response, reproducible build hashes, contract and chain monitoring, canary risk limits and formally reviewed changes. On-chain transactions are generally irreversible; webpage rollback does not undo token transfers or contract upgrades.

## Required sequence (none bypassed)

1. Complete deployment integrations and audited code for M5, M7, M9, M11, M12/M14 and M15; verify actual constructor/role/TTL and token issuer provenance.
2. Complete M21 genuine four-wallet end-to-end transactions including all relevant risk and financial deltas—not only receipts.
3. Commission independent M22 security and economic audit, fix findings, retest and conduct live on-chain chaos and recovery.
4. Open, operate and close M23 **financial Testnet** beta after an independent audit and approved valueless token/faucet. Report *actual* Testnet usage and incidents rather than invented volume.
5. Document the 12 M24 controls with independently validated and signed evidence. Review protocol governance, treasury/liquidity, risk-committee limits, legal/compliance jurisdiction, monitor ownership and disaster recovery.
6. Convene a distinct external go/no-go board. A human-controlled production deployment, signing ceremony, canary transaction and public communication would require a **separate** explicit request and independent release authorisation. Do not interpret this document as such a request.

## Operator decision matrix

| Incident | Primary halt | Non-negotiable restart evidence |
| --- | --- | --- |
| Oracle stale/divergent | New borrowing/perp exposure through deployed risk guardian | Independently authenticated fresh on-chain oracle; actual halt/restore receipts |
| RPC fork/reset | Financial indexer trust and derived credits | Reconciled canonical ledgers, transaction/replay proofs |
| Insolvency | New liabilities and unsafe market operations | Real assets versus all claims and insurance, independent loss review |
| Compromised key | Privileged signing/upgrade action | On-chain role revocation/rotation and independent governance quorum |
| Liquidation/funding error | Risk-adding positions | Debt, reserves, keeper performance and on-chain unwind proof |
| Upgrade mismatch | Rollout and unverified contract interfaces | Audited installed code hash, signer authorities, governance receipts |

**M24 software readiness can be completed without opening mainnet.** The current state remains **NO-GO**, and live financial Testnet beta remains **CLOSED**.
