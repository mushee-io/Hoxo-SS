/**
 * M24 — mainnet-readiness assessment, not an automated launch authorization.
 *
 * Mainnet cannot be enabled by JSON claims, CI results, or a governance flag.
 * External independent evidence, audited contracts, real on-chain verification
 * and a separately approved launch process are required. This module reads
 * NO keys, sends NO transactions and exposes NO mainnet execution path.
 */
import {validateRegistry} from "../infra/registry.mjs";
import {m21Readiness} from "../verification/m21.mjs";
import {m22AuditReadiness} from "../security/m22-review.mjs";
import {m23Readiness} from "../beta/readiness.mjs";

export const M24_CRITERIA=Object.freeze([
  {id:"M24-01",category:"Chain provenance",severity:"critical",
    ownerRole:"protocol engineering",
    required:"Independently verify deployed mainnet contract code hashes, admins, upgrades and canonical token/issuer identities after Testnet approval"},
  {id:"M24-02",category:"Integration",severity:"critical",
    ownerRole:"protocol engineering",
    required:"Demonstrate atomically enforced M15 cross-product margin linked to spot, lending, perp settlement and real authenticated oracle/risk"},
  {id:"M24-03",category:"Testnet evidence",severity:"critical",
    ownerRole:"security and QA",
    required:"Complete M21 genuine multi-wallet Testnet lifecycle with signed receipts, token balances, debt, liquidation and solvency reconciled"},
  {id:"M24-04",category:"External audit",severity:"critical",
    ownerRole:"independent security auditor",
    required:"Independent on-chain code and economic audit, source revision scope, critical/high findings remediated and auditor follow-up attestation"},
  {id:"M24-05",category:"Risk parameters",severity:"critical",
    ownerRole:"risk committee",
    required:"Approve signed risk limits for collateral factors, borrow and funding caps, leverage, price staleness, bad-debt/insurance and liquidation response"},
  {id:"M24-06",category:"Liquidity and treasury",severity:"critical",
    ownerRole:"treasury and market operations",
    required:"Document real seeded liquidity, asset listing due diligence, insurance reserve attestations, market-maker commitments and stress-funded runway"},
  {id:"M24-07",category:"Governance and keys",severity:"critical",
    ownerRole:"governance multisig signatories",
    required:"Verify independent multisig threshold, role separation, secure signing devices, timelocked upgrades, revocation and emergency guardians"},
  {id:"M24-08",category:"Legal and compliance",severity:"critical",
    ownerRole:"qualified legal/compliance review",
    required:"Review jurisdiction, derivatives/credit permissions, customer protections, sanctions, AML obligations and disclosures; obtain applicable approvals"},
  {id:"M24-09",category:"Operations",severity:"high",
    ownerRole:"SRE and security operations",
    required:"Prove active monitoring/alerts, backups, incident escalation, rate limits, recoverability, dependency resilience and independent ledger reconciliation"},
  {id:"M24-10",category:"Emergency rollback",severity:"critical",
    ownerRole:"security guardian and incident commander",
    required:"Exercise actual on-chain pause, safe unwind, storage TTL restoration, guardian failover, exploit response and irreversibility disclosure"},
  {id:"M24-11",category:"Change control",severity:"high",
    ownerRole:"release manager",
    required:"Pin reviewed source, build toolchain/WASM, deployment artifacts, signed release manifest, staged rollouts, canary budgets and explicit go/no-go decision"},
  {id:"M24-12",category:"Public beta proof",severity:"critical",
    ownerRole:"independent release committee",
    required:"Complete M23 valueless public Testnet beta with monitored incident drills, user evidence and formally approved release closeout"},
].map(x=>Object.freeze(x)));

export function m24Readiness(registry){
  const registryReport=validateRegistry(registry);
  const m21=m21Readiness(registry),m22=m22AuditReadiness(registry),m23=m23Readiness(registry);
  const blockers=M24_CRITERIA.map(x=>Object.freeze({...x,status:"OPEN",verifiedByIndependentAuthority:false}));
  return Object.freeze({
    milestone:"M24",scope:"READ_ONLY_MAINNET_LAUNCH_PREPARATION",
    state:"NO_GO_INDEPENDENT_APPROVAL_AND_LIVE_PROOF_MISSING",
    networkForCurrentDeployments:"STELLAR_TESTNET_ONLY",
    financialTestnetBetaOpen:false,
    mainnetLaunchApproved:false,
    mainnetOperationsEnabled:false,
    walletSigningEnabled:false,
    mainnetTransactionsSubmitted:0,
    verifiedMainnetContractCount:0,
    testnetCandidateContracts:registryReport.candidateContracts,
    independentRiskApproval:false,
    independentAuditCompleted:false,
    liquidityCommittedVerified:false,
    governanceApproved:false,
    legalComplianceApproved:false,
    productionLiquidityUsd:null,
    productionTVLUsd:null,
    unresolvedCriteria:blockers.length,
    blockers,
    dependencies:Object.freeze({
      M21:m21.state,M22:m22.state,M23:m23.status
    }),
    nextDecision:"REQUIRE_SEPARATE_EXTERNAL_GO_NO_GO_BOARD_AFTER_ALL_PREREQUISITES",
    reason:"M24 documents and tests launch criteria; it cannot self-verify audits, custody, real market state, liquidity, legal approval or governance signatures."
  });
}

/** All inputs—including forged approvals and ready=true—are ignored as authority. */
export function assertM24LaunchAuthorized(registry){
  const assessment=m24Readiness(registry);
  const error=new Error("M24 MAINNET NO-GO: external approvals, on-chain proof and a separate launch decision are outstanding");
  error.code="M24_LAUNCH_PROHIBITED";
  error.assessment=assessment;
  throw error;
}
