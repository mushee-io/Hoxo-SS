/**
 * M23 one-shot read-only operational telemetry.
 * Network health is NOT contract health; no synthetic PnL, TVL or volume.
 * Never starts a background worker, sends alerts, signs or broadcasts.
 */
import {probeInfrastructure} from "../infra/network.mjs";
import {TESTNET_CONFIG} from "../config/testnet.mjs";
import {m23Readiness} from "./readiness.mjs";

export async function m23StatusSnapshot({
  registry,withNetwork=false,probe=probeInfrastructure,
  nowMs=Date.now(),timeoutMs=12000,
}={}){
  const readiness=m23Readiness(registry);
  if(typeof withNetwork!=="boolean"||typeof probe!=="function"||
     !Number.isFinite(nowMs)||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<1000||timeoutMs>30000)
    throw Error("Invalid M23 status probe configuration");
  let network=null;
  if(withNetwork)network=await probe({config:TESTNET_CONFIG,nowMs,timeoutMs});
  const networkHealthy=network?.state==="verified"&&
    network.horizon?.state==="verified"&&network.rpc?.state==="verified";
  const infrastructureState=!withNetwork?"NOT_PROBED":
    networkHealthy?"READ_ONLY_TESTNET_ENDPOINTS_VERIFIED":"READ_ONLY_ENDPOINTS_UNAVAILABLE";
  const alerts=[];
  if(withNetwork&&!networkHealthy)alerts.push("STELLAR_TESTNET_RPC_OR_HORIZON_UNVERIFIED");
  alerts.push("PUBLIC_HOXO_BETA_BLOCKED");
  alerts.push("NO_VERIFIED_HOXO_CONTRACT_DEPLOYMENTS");
  alerts.push("NO_APPROVED_CANONICAL_ORACLE_OR_RISK");
  alerts.push("INDEPENDENT_AUDIT_AND_M21_SIGNED_LIFECYCLE_MISSING");
  return Object.freeze({
    milestone:"M23",generatedAt:new Date(nowMs).toISOString(),
    mode:withNetwork?"ONE_SHOT_READ_ONLY_NETWORK_OBSERVATION":"LOCAL_RELEASE_GATE_ONLY",
    infrastructureState,
    network:withNetwork?{
      status:network?.state??"unknown",
      horizonStatus:network?.horizon?.state??"unknown",
      horizonLedger:network?.horizon?.ledger??null,
      rpcStatus:network?.rpc?.state??"unknown",
      rpcLedger:network?.rpc?.ledger??null,
      ledgerDifference:network?.ledgerDelta??null,
    }:null,
    betaOpen:readiness.publicBetaOpen,
    contractsVerified:readiness.independentlyVerifiedContractCount,
    realHoxoTransactionsVerified:false,
    financialDataSource:"NONE",
    legitimateTvlUsd:null,legitimateVolumeUsd:null,realizedPnlUsd:null,
    transactionSigningSupported:false,
    transfersPermitted:false,
    observedInfrastructureDoesNotProveProtocol:true,
    alerts,
  });
}
