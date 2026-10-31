/**
 * M22 audit gate. Intentionally cannot self-certify contract security.
 * Automated tests and a registry claim do NOT substitute for an external audit.
 */
import {validateRegistry} from "../infra/registry.mjs";
export const M22_OPEN_BLOCKERS=Object.freeze([
  Object.freeze({id:"M22-01",severity:"critical",area:"contract deployment",
    reason:"No independently verified Stellar Testnet contract bytecode, admin authority or deployed Hoxo transaction evidence"}),
  Object.freeze({id:"M22-02",severity:"critical",area:"oracle and risk",
    reason:"No audited on-chain price oracle, risk authority, stale-price guardian or incident recovery exercise"}),
  Object.freeze({id:"M22-03",severity:"critical",area:"unified collateral",
    reason:"M15 reservations not integrated atomically with spot, lending and perps; no reconciled single collateral ledger"}),
  Object.freeze({id:"M22-04",severity:"critical",area:"independent audit",
    reason:"No independent contract audit, reviewed findings, signed acceptance, fuzz/chaos scope coverage or remediation signoff"}),
  Object.freeze({id:"M22-05",severity:"high",area:"economic safety",
    reason:"No real wallet deposit/borrow/perp/liquidation/repayment/withdrawal transactions and state-delta/insolvency proof"}),
  Object.freeze({id:"M22-06",severity:"high",area:"operations",
    reason:"No production recovery procedure demonstrated for RPC reset, TTL expiration, oracle outage or keeper failure"}),
  Object.freeze({id:"M22-07",severity:"high",area:"API infrastructure",
    reason:"M19 candidate journal and M20 rate limits are single-process; no production-scale authenticated financial indexer"}),
]);
export function m22AuditReadiness(registry){
  const summary=validateRegistry(registry);
  const candidateCount=summary.candidateContracts;
  return Object.freeze({
    milestone:"M22",
    state:"BLOCKED_EXTERNAL_AUDIT_AND_LIVE_TESTNET_EVIDENCE_REQUIRED",
    scope:"SOURCE_SECURITY_TESTING_ONLY",
    network:"STELLAR_TESTNET",
    contractCandidatesInRegistry:candidateCount,
    independentlyVerifiedDeployments:0,
    unresolvedCount:M22_OPEN_BLOCKERS.length,
    blockers:M22_OPEN_BLOCKERS.map(x=>({...x,status:"OPEN"})),
    automatedTestCoverageIsAnAudit:false,
    externalAuditorApproved:false,
    onchainEconomicStateVerified:false,
    depositTradingEnabled:false,
    publicBetaPermitted:false,
    mainnetPermitted:false,
  });
}
export function assertM22ReleaseApproved(registry){
  // Never accept user-supplied assertion/overrides as evidence.
  const status=m22AuditReadiness(registry);
  const error=new Error("M22 release DENIED: independent audit and verified Testnet economic evidence outstanding");
  error.code="M22_RELEASE_BLOCKED";
  error.status=status;
  throw error;
}
