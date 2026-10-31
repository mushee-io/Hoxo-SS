import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {M23_PACKAGES,m23DeploymentPlan} from "../beta/deployment-plan.mjs";
import {m23Readiness,requireM23PublicBetaApproval} from "../beta/readiness.mjs";
import {m23StatusSnapshot} from "../beta/telemetry.mjs";
import {m23FundingPreview,requestM23TestnetXlm,M23_FAUCET_ACK,
  M23_FRIENDBOT_ORIGIN} from "../beta/faucet.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";

const TEST_G=(()=>{
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes=[48,...Array(32).fill(19)];
  let crc=0;
  for(const byte of bytes){
    crc^=byte<<8;
    for(let i=0;i<8;i++)crc=crc&32768?((crc<<1)^0x1021)&65535:(crc<<1)&65535;
  }
  bytes.push(crc&255,crc>>8);
  let value=0,bits=0,out="";
  for(const n of bytes){
    value=(value<<8)|n;bits+=8;
    while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31];value&=(1<<bits)-1;}
  }
  if(bits)out+=alphabet[(value<<(5-bits))&31];
  return out;
})();
const WASM=Buffer.from([0,97,115,109,1,0,0,0]);
async function registry(){
  return JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
}
async function temp(t){
  const p=await mkdtemp(join(tmpdir(),"hoxo-m23-"));
  t.after(()=>rm(p,{recursive:true,force:true}));
  return p;
}
test("M23 release refuses self-approved market deployment, trading or fake TVL",async()=>{
  const r=await registry();
  const status=m23Readiness(r);
  assert.equal(status.status,"BLOCKED_UNVERIFIED_PUBLIC_BETA");
  assert.equal(status.readOnlyDevelopmentPreviewPermitted,true);
  assert.equal(status.publicBetaOpen,false);
  assert.equal(status.tradingPermitted,false);
  assert.equal(status.mainnetPermitted,false);
  assert.equal(status.publicTvlUsd,null);
  assert.equal(status.requirements.length,7);
  assert.equal(status.outstanding,7);
  assert.throws(()=>requireM23PublicBetaApproval(r),e=>
    e.code==="M23_PUBLIC_BETA_NOT_APPROVED"&&e.readiness.publicBetaOpen===false);
  const forged={...r,auditApproved:true,live:true,volumeUsd:"1000000000",
    releaseApproval:{verified:true}};
  assert.equal(m23Readiness(forged).publicBetaOpen,false);
  assert.throws(()=>requireM23PublicBetaApproval(forged),/BLOCKED/);
});
test("M23 plan requires real fixed-name valid WASM bytes and preserves SHA256 without deploy",async t=>{
  const dir=await temp(t),r=await registry();
  const missing=await m23DeploymentPlan({wasmDirectory:dir,registry:r});
  assert.equal(missing.missingArtifacts.length,M23_PACKAGES.length);
  assert.equal(missing.state,"INCOMPLETE_BUILD_ARTIFACTS");
  assert.equal(missing.broadcastPerformed,false);
  assert.equal(missing.deployedContractCount,0);
  assert.equal(missing.missingCanonicalOracle,true);
  for(const item of M23_PACKAGES)await writeFile(join(dir,item.wasm),WASM);
  const plan=await m23DeploymentPlan({
    wasmDirectory:dir,registry:r,sourceRevision:"a".repeat(64)});
  assert.equal(plan.artifacts.length,6);
  assert.equal(plan.state,"COMPLETE_ARTIFACT_HASH_INVENTORY_ONLY");
  assert.ok(plan.artifacts.every(x=>x.sha256===createHash("sha256").update(WASM).digest("hex")));
  assert.ok(plan.artifacts.every(x=>x.sizeBytes===8));
  assert.equal(plan.releasePermitted,false);
  assert.equal(plan.deploymentConfirmed,false);
  assert.equal(plan.signerStored,false);
  assert.deepEqual(plan.missingArtifacts,[]);
  assert.throws(()=>m23DeploymentPlan({wasmDirectory:dir,registry:r,
    sourceRevision:"not-a-full-commit"}),/revision/);
  await writeFile(join(dir,M23_PACKAGES[0].wasm),"NOT WASM");
  await assert.rejects(()=>m23DeploymentPlan({wasmDirectory:dir,registry:r}),/WASM header/);
});
test("M23 deployment inventory rejects symlinked artifacts",async t=>{
  const dir=await temp(t),r=await registry();
  const realFile=join(dir,"other.wasm");
  await writeFile(realFile,WASM);
  await symlink(realFile,join(dir,M23_PACKAGES[0].wasm));
  await assert.rejects(()=>m23DeploymentPlan({wasmDirectory:dir,registry:r}),/linked/);
});
test("M23 one-shot telemetry does not fetch by default, invent volumes or imply beta",async()=>{
  let calls=0;
  const snapshot=await m23StatusSnapshot({registry:await registry(),
    nowMs:1800000000000,probe:async()=>{calls++;throw Error("must not probe");}});
  assert.equal(calls,0);
  assert.equal(snapshot.infrastructureState,"NOT_PROBED");
  assert.equal(snapshot.network,null);
  assert.equal(snapshot.betaOpen,false);
  assert.equal(snapshot.legitimateTvlUsd,null);
  assert.equal(snapshot.realizedPnlUsd,null);
  assert.equal(snapshot.transfersPermitted,false);
});
test("M23 monitor categorises independently verified endpoints but never Hoxo market activity",async()=>{
  const r=await registry();
  let probeCalls=0;
  const ok=await m23StatusSnapshot({registry:r,withNetwork:true,
    nowMs:1800000000000,probe:async()=>{
      probeCalls++;
      return {state:"verified",horizon:{state:"verified",ledger:200},
        rpc:{state:"verified",ledger:200},ledgerDelta:0};
    }});
  assert.equal(probeCalls,1);
  assert.equal(ok.infrastructureState,"READ_ONLY_TESTNET_ENDPOINTS_VERIFIED");
  assert.equal(ok.network.horizonLedger,200);
  assert.equal(ok.betaOpen,false);
  assert.equal(ok.financialDataSource,"NONE");
  const outage=await m23StatusSnapshot({registry:r,withNetwork:true,
    probe:async()=>({state:"unavailable",horizon:{state:"verified"},
      rpc:{state:"stale"}})});
  assert.equal(outage.infrastructureState,"READ_ONLY_ENDPOINTS_UNAVAILABLE");
  assert.ok(outage.alerts.includes("STELLAR_TESTNET_RPC_OR_HORIZON_UNVERIFIED"));
  assert.equal(outage.betaOpen,false);
});
test("M23 Friendbot preview validates public G addresses without secrets",()=>{
  assert.equal(m23FundingPreview(TEST_G).fundingRequested,false);
  assert.equal(m23FundingPreview(TEST_G).accountFunded,false);
  assert.throws(()=>m23FundingPreview("S"+"A".repeat(55)),/checksum-valid/);
  assert.throws(()=>m23FundingPreview("not-a-key"),/checksum-valid/);
});
test("M23 Friendbot refuses funding with no ACK or bad canonical network proof",async()=>{
  let probes=0,fetchCalls=0;
  const options={account:TEST_G,fetchImpl:async()=>{fetchCalls++;return {ok:true,status:200};},
    probe:async()=>{probes++;return {state:"verified",horizon:{state:"verified"},
      rpc:{state:"verified"}}}};
  await assert.rejects(()=>requestM23TestnetXlm(options),/acknowledgement/);
  assert.equal(probes,0);assert.equal(fetchCalls,0);
  await assert.rejects(()=>requestM23TestnetXlm({...options,
    acknowledgement:M23_FAUCET_ACK,
    probe:async()=>({state:"mismatch",horizon:{state:"verified"},rpc:{state:"mismatch"}})}),/handshake/);
  assert.equal(fetchCalls,0);
});
test("M23 requested Friendbot funding calls only the official Testnet HTTPS origin after double preflight",async()=>{
  const seen=[];
  const response=await requestM23TestnetXlm({
    account:TEST_G,acknowledgement:M23_FAUCET_ACK,
    probe:async()=>({state:"verified",horizon:{state:"verified"},rpc:{state:"verified"}}),
    fetchImpl:async(url,options)=>{
      seen.push({url,options});
      return {ok:true,status:200,json:async()=>({untrustedData:"do not rely on it"})};
    }});
  assert.equal(seen.length,1);
  assert.equal(new URL(seen[0].url).origin,M23_FRIENDBOT_ORIGIN);
  assert.equal(new URL(seen[0].url).searchParams.get("addr"),TEST_G);
  assert.equal(seen[0].options.method,"GET");
  assert.equal(seen[0].options.redirect,"error");
  assert.equal(response.fundingRequested,true);
  assert.equal(response.accountFunded,false);
  assert.equal(response.independentFundingVerificationRequired,true);
  assert.equal(response.financialTradingEnabled,false);
  assert.equal(response.passphrase,TESTNET_PASSPHRASE);
});
test("M23 failed Friendbot rate limits or already funded state never claim credit",async()=>{
  await assert.rejects(()=>requestM23TestnetXlm({account:TEST_G,
    acknowledgement:M23_FAUCET_ACK,
    probe:async()=>({state:"verified",horizon:{state:"verified"},rpc:{state:"verified"}}),
    fetchImpl:async()=>({ok:false,status:400}),
  }),/did not accept/);
});
