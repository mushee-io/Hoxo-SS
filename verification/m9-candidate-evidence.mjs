/** Public-only M9 deployment candidate record. NOT deployment verification. */
import {isStellarContractId} from "../infra/registry.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
const HEX=/^[0-9a-f]{64}$/;
const G=/^G[A-Z2-7]{55}$/;
const exact=(o,keys)=>{
  if(!o||typeof o!=="object"||Array.isArray(o)||Object.getPrototypeOf(o)!==Object.prototype)return false;
  const descriptors=Object.getOwnPropertyDescriptors(o);
  const names=Reflect.ownKeys(descriptors);
  return names.length===keys.length&&names.every(k=>typeof k==="string"&&keys.includes(k)&&"value" in descriptors[k]);
};
export function inspectM9Candidate(candidate){
  const keys=["networkPassphrase","role","contractId","owner","wasmUploadTxHash","deploymentTxHash","wasmUploadLedger","deploymentLedger","reportedWasmFileSha256","constructorOwner","adminVerified","pausedVerified","onchainCodeHashVerified","deploymentXdrLinked"];
  if(!exact(candidate,keys))throw Error("Candidate must use exact public evidence schema");
  // Snapshot data properties only. Never invoke a caller-controlled accessor during validation.
  const values=Object.getOwnPropertyDescriptors(candidate);
  candidate=Object.fromEntries(keys.map(k=>[k,values[k].value]));
  if(candidate.networkPassphrase!==TESTNET_PASSPHRASE||candidate.role!=="spot-settlement"||
     !isStellarContractId(candidate.contractId)||!G.test(candidate.owner)||
     candidate.constructorOwner!==candidate.owner||
     ![candidate.wasmUploadTxHash,candidate.deploymentTxHash,candidate.reportedWasmFileSha256].every(x=>typeof x==="string"&&HEX.test(x))||
     candidate.wasmUploadTxHash===candidate.deploymentTxHash||
     !Number.isSafeInteger(candidate.wasmUploadLedger)||candidate.wasmUploadLedger<1||
     !Number.isSafeInteger(candidate.deploymentLedger)||candidate.deploymentLedger<candidate.wasmUploadLedger||
     !["unknown",true,false].includes(candidate.adminVerified)||
     !["unknown",true,false].includes(candidate.pausedVerified)||
     !["unknown",true,false].includes(candidate.onchainCodeHashVerified)||
     !["unknown",true,false].includes(candidate.deploymentXdrLinked))
    throw Error("Invalid or contradictory M9 Testnet candidate");
  return Object.freeze({
    role:candidate.role,contractId:candidate.contractId,
    evidenceStatus:"USER_REPORTED_CANDIDATE_NOT_INDEPENDENTLY_VERIFIED",
    operatorReportedUploadLedger:candidate.wasmUploadLedger,
    operatorReportedDeploymentLedger:candidate.deploymentLedger,
    registryPromotionAllowed:false,spotTradingAllowed:false,publicBetaAllowed:false,
    outstanding:[
      "Independently retrieve Testnet upload and CreateContractV2 transaction XDR and link exact C-address",
      "Compare deployed WASM bytes/code hash with independently reviewed build",
      "Read contract owner/admin and verify expected constructor",
      "Read paused state; require paused=true before any controlled activation",
      "Review valueless token custody and distinct-party signed settlement with real receipt",
      "Complete risk and independent security gates before public beta"
    ]
  });
}
