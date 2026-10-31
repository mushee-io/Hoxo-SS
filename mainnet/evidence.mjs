/**
 * M24 local release-packet inventory. Hashes actual external files without
 * inspecting private keys, and NEVER accepts file presence as an approval.
 * The inventory digest is reproducible, not a trusted signature or audit.
 */
import {readFile,lstat,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {m24Readiness} from "./readiness.mjs";

export const M24_PACKET_FILES=Object.freeze([
  ["audit-report.pdf","Independent code and economic audit, scope, findings and auditor signatures"],
  ["audit-remediation.pdf","Independent critical/high remediation and re-audit sign-off"],
  ["testnet-deployments.json","Actual verified Testnet contract WASM/source hashes, roles and deployments"],
  ["testnet-lifecycle.json","Actual M21 transaction and balance/state-reconciliation proofs"],
  ["risk-committee.pdf","Risk parameter, oracle/insurance and leverage committee approval"],
  ["liquidity-treasury.pdf","Asset due diligence, funding/insurance liquidity and market-maker agreements"],
  ["governance-keys.pdf","Verified multisig, governance threshold and key/upgrade/guardian review"],
  ["legal-compliance.pdf","Independent jurisdictional financial service and compliance opinion"],
  ["mainnet-ops.md","Mainnet operational ownership, escalation, limits, rollback and monitoring procedures"],
  ["incident-rehearsal.json","Actual paused/resumed contracts, verified chaos and recovery Testnet proofs"],
  ["public-beta-report.pdf","Approved closed-out public valueless Testnet beta acceptance report"],
  ["launch-go-no-go.pdf","Independent signed governance and release-committee launch decision"],
].map(([file,purpose])=>Object.freeze({file,purpose})));

const MAX_FILE_BYTES=10*1024*1024;
const COMMIT=/^[a-fA-F0-9]{40}$/;
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");

export async function prepareM24EvidencePacket({
  directory,registry,sourceRevision,
}={}){
  const readiness=m24Readiness(registry);
  if(typeof directory!=="string"||!directory||directory.includes("\0"))
    throw Error("M24 evidence directory must be explicitly supplied");
  if(typeof sourceRevision!=="string"||!COMMIT.test(sourceRevision))
    throw Error("M24 sourceRevision must be a complete 40-digit Git SHA-1, never a branch name");
  const path=await realpath(resolve(directory));
  if(!(await lstat(path)).isDirectory())throw Error("M24 evidence path is not a directory");
  const files=[];
  for(const spec of M24_PACKET_FILES){
    const filePath=join(path,spec.file);
    let metadata;
    try{metadata=await lstat(filePath);}
    catch(e){
      if(e.code==="ENOENT"){
        files.push({file:spec.file,purpose:spec.purpose,status:"MISSING",sha256:null,sizeBytes:null});
        continue;
      }
      throw e;
    }
    if(metadata.isSymbolicLink()||!metadata.isFile())
      throw Error("M24 evidence must be a direct regular file (no symlink): "+spec.file);
    if(metadata.size===0||metadata.size>MAX_FILE_BYTES)
      throw Error("M24 evidence size outside allowed 1–10MiB range: "+spec.file);
    const bytes=await readFile(filePath);
    if(bytes.length!==metadata.size)
      throw Error("M24 evidence file changed during inventory: "+spec.file);
    if(spec.file.endsWith(".pdf")&&!bytes.subarray(0,5).equals(Buffer.from("%PDF-")))
      throw Error("M24 evidence PDF header invalid: "+spec.file);
    if(spec.file.endsWith(".json")){
      let data;
      try{data=JSON.parse(bytes.toString("utf8"));}
      catch{throw Error("M24 evidence JSON invalid: "+spec.file);}
      if(!data||typeof data!=="object"||Array.isArray(data))
        throw Error("M24 evidence JSON must be an object: "+spec.file);
    }
    files.push({file:spec.file,purpose:spec.purpose,status:"HASHED_NOT_INDEPENDENTLY_REVIEWED",
      sha256:digest(bytes),sizeBytes:bytes.length});
  }
  const payload={schemaVersion:1,sourceRevision:sourceRevision.toLowerCase(),
    files:files.map(({file,status,sha256,sizeBytes})=>({file,status,sha256,sizeBytes}))};
  return Object.freeze({
    milestone:"M24",
    network:"STELLAR_TESTNET_PRELAUNCH_REFERENCE",
    sourceRevision:sourceRevision.toLowerCase(),
    releaseGateState:readiness.state,
    evidenceFormatVersion:1,
    status:"ARTIFACT_INVENTORY_ONLY",
    missing:files.filter(x=>x.status==="MISSING").map(x=>x.file),
    files,
    deterministicInventorySha256:digest(Buffer.from(JSON.stringify(payload))),
    independentAuditorSignatureVerified:false,
    governanceSignaturesVerified:false,
    legalApprovalVerified:false,
    onchainProofIndependentlyVerified:false,
    launchPermitted:false,
    notes:"SHA-256 inventory records local bytes only. It cannot certify author, contents, signatures, code deployment or release approval. Never store seeds/credentials in evidence files."
  });
}
