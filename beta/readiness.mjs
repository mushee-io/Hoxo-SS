/**
 * M23 — public beta readiness cannot be self-certified.
 *
 * A public *read-only development preview* can be hosted, but no real Hoxo
 * deposits, spot, credit, margin, or perps may be enabled by this status.
 * No user-supplied "approved" flag is accepted as independent evidence.
 */
import {validateRegistry} from "../infra/registry.mjs";
import {m21Readiness} from "../verification/m21.mjs";
import {m22AuditReadiness} from "../security/m22-review.mjs";

const RELEASE_REQUIREMENTS=Object.freeze([
  ["M23-01","Verified Stellar Testnet deployment receipts, source/WASM hashes and audited administrator roles for all canonical contracts"],
  ["M23-02","Authenticated and independently audited canonical oracle and risk authority, with M15 integrated atomically with spot/lending/perps"],
  ["M23-03","M21 complete real four-wallet Testnet lifecycle, genuine signed transaction receipts and verified pre/post financial state"],
  ["M23-04","M22 independent external security audit and resolved critical/high findings, with real on-chain recovery/chaos exercise"],
  ["M23-05","A valueless verified test asset and controlled public faucet/supply limits without mainnet assets or fabricated liquidity"],
  ["M23-06","Operational alerting, persistent RPC/indexer monitoring, safe rollback, incident contacts and responsible disclosure triage"],
  ["M23-07","Operator-approved repeatable deployment/change-control and post-reset revalidation plus public beta documentation"],
].map(([id,reason])=>Object.freeze({id,reason})));

export function m23Readiness(registry){
  const registrySummary=validateRegistry(registry);
  const prior21=m21Readiness(registry);
  const prior22=m22AuditReadiness(registry);
  return Object.freeze({
    milestone:"M23",network:"STELLAR_TESTNET",
    status:"BLOCKED_UNVERIFIED_PUBLIC_BETA",
    readOnlyDevelopmentPreviewPermitted:true,
    publicBetaOpen:false,
    depositPermitted:false,
    lendingPermitted:false,
    perpPermitted:false,
    tradingPermitted:false,
    mainnetPermitted:false,
    realHoxoTransactionsVerified:false,
    fullyReconciledMargin:false,
    independentlyVerifiedContractCount:0,
    candidateContractCount:registrySummary.candidateContracts,
    externalAuditApproved:prior22.externalAuditorApproved,
    priorMilestones:Object.freeze({M21:prior21.state,M22:prior22.state}),
    requirements:RELEASE_REQUIREMENTS.map(x=>({...x,state:"OPEN"})),
    outstanding:RELEASE_REQUIREMENTS.length,
    publicVolumeUsd: null,
    publicTvlUsd: null,
    publicPnlUsd: null,
    reason:"Source tests and network health do not establish audited deployed Hoxo financial markets.",
  });
}
export function requireM23PublicBetaApproval(registry){
  const readiness=m23Readiness(registry);
  const error=new Error("M23 PUBLIC BETA BLOCKED: independent audit, verified Testnet deployments and financial lifecycle outstanding");
  error.code="M23_PUBLIC_BETA_NOT_APPROVED";
  error.readiness=readiness;
  throw error;
}
