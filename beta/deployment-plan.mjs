/**
 * M23 reproducible Stellar Testnet WASM deployment PLAN ONLY.
 * Reads compiled WASM bytes; does NOT execute Stellar CLI, hold signers, deploy,
 * change registry, claim audit approval or emit transaction receipts.
 */
import {readFile,lstat,realpath} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {createHash} from "node:crypto";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {validateRegistry} from "../infra/registry.mjs";

export const M23_PACKAGES=Object.freeze([
  {role:"oracle-adapter",package:"hoxo-oracle-adapter",wasm:"hoxo_oracle_adapter.wasm",kind:"TWO_PUBLISHER_CANDIDATE_ONLY"},
  {role:"risk-engine",package:"hoxo-canonical-risk",wasm:"hoxo_canonical_risk.wasm",kind:"SPOT_RESERVATION_ONLY_BORROWING_PERPS_DENIED"},
  {role:"collateral-vault",package:"hoxo-collateral-vault",wasm:"hoxo_collateral_vault.wasm",kind:"PAUSED_DEFAULT"},
  {role:"spot-settlement",package:"hoxo-spot-settlement",wasm:"hoxo_spot_settlement.wasm",kind:"PAUSED_DEFAULT"},
  {role:"money-market",package:"hoxo-money-market",wasm:"hoxo_money_market.wasm",kind:"BORROWING_DISABLED_DEFAULT"},
  {role:"perp-clearinghouse",package:"hoxo-perp-clearinghouse",wasm:"hoxo_perp_clearinghouse.wasm",kind:"PAUSED_DEFAULT"},
  {role:"unified-margin",package:"hoxo-unified-margin",wasm:"hoxo_unified_margin.wasm",kind:"PAUSED_DEFAULT"},
].map(x=>Object.freeze(x)));
const HEX=/^[a-f0-9]{64}$/;
const WASM_HEADER=Buffer.from([0,97,115,109,1,0,0,0]);

async function inspectWasm(root,item){
  const path=join(root,item.wasm);
  let status;
  try{status=await lstat(path);}
  catch(error){
    if(error.code==="ENOENT")return {role:item.role,package:item.package,
      wasm:item.wasm,state:"MISSING",sha256:null,sizeBytes:null};
    throw error;
  }
  if(!status.isFile()||status.isSymbolicLink())
    throw Error("M23 refuses non-regular or linked WASM artifact "+item.wasm);
  if(status.size<8||status.size>10_000_000)
    throw Error("M23 WASM size outside 8-byte to 10MB review bounds "+item.wasm);
  const bytes=await readFile(path);
  if(bytes.length!==status.size||!bytes.subarray(0,8).equals(WASM_HEADER))
    throw Error("M23 malformed or changed WASM header "+item.wasm);
  const hash=createHash("sha256").update(bytes).digest("hex");
  if(!HEX.test(hash))throw Error("Invalid hash result");
  return {role:item.role,package:item.package,wasm:item.wasm,
    state:"ARTIFACT_SHA256_CAPTURED_NOT_DEPLOYED",sha256:hash,sizeBytes:bytes.length};
}
export async function m23DeploymentPlan({
  wasmDirectory,registry,sourceRevision="UNSPECIFIED",
}){
  validateRegistry(registry);
  if(typeof wasmDirectory!=="string"||!wasmDirectory||wasmDirectory.includes("\0"))
    throw Error("M23 requires an explicit local WASM artifact directory");
  if(sourceRevision!=="UNSPECIFIED"&&
     (typeof sourceRevision!=="string"||!HEX.test(sourceRevision.toLowerCase())))
    throw Error("M23 source revision must be a full 64-hex Git SHA or UNSPECIFIED");
  const root=await realpath(resolve(wasmDirectory));
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory())throw Error("M23 WASM path must be a directory");
  const artifacts=[];
  for(const item of M23_PACKAGES)artifacts.push(await inspectWasm(root,item));
  const missing=artifacts.filter(a=>a.state==="MISSING").map(a=>a.role);
  const oracle=registry.contracts.find(x=>x.role==="oracle-adapter");
  return {
    milestone:"M23",
    networkPassphrase:TESTNET_PASSPHRASE,
    network:"testnet",
    mode:"REPRODUCIBLE_REVIEW_ONLY_NO_DEPLOYMENT",
    sourceRevision,
    sourceSignerProvided:false,
    signerStored:false,
    broadcastPerformed:false,
    deployedContractCount:0,
    deploymentConfirmed:false,
    artifacts,
    missingArtifacts:missing,
    missingCanonicalOracle:oracle?.status!=="candidate",
    releasePermitted:false,
    state:missing.length?"INCOMPLETE_BUILD_ARTIFACTS":"COMPLETE_ARTIFACT_HASH_INVENTORY_ONLY",
    operatorInstructions:[
      "Run cargo test --workspace --all-targets and stellar contract build under pinned, reviewed CLI/toolchain.",
      "Independently review each compiled WASM SHA256, source revision, constructors and role permissions.",
      "Acquire an externally controlled funded STELLAR TESTNET operator identity; never paste a secret into this repository.",
      "Require external security audit and real M21 proof BEFORE considering public beta access.",
      "For operator reference ONLY: stellar contract deploy --network testnet --source-account <SECURE_LOCAL_ALIAS> --wasm <REVIEWED_WASM_PATH>.",
      "Record actual tx hash, ledger, deployed C-address, installed WASM code hash, constructor arguments and TTL in independent evidence.",
      "Registry entries may be changed to candidate after verification; registry cannot assert audit approval.",
    ],
  };
}
