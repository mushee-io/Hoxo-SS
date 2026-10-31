import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";
import {M21_STEPS,m21Readiness,validateM21Manifest,
  verifyM21Receipts,makeM21Rpc} from "../verification/m21.mjs";
const NOW=1_800_000_000_000;
const CLOSE=String(Math.floor((NOW-5000)/1000));
const ABC="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const HASH="a".repeat(64);
function address(version,seed){
  const bytes=[version,...Array(32).fill(seed)];let crc=0;
  for(const b of bytes){crc^=b<<8;for(let i=0;i<8;i++)crc=crc&32768?((crc<<1)^0x1021)&65535:(crc<<1)&65535;}
  bytes.push(crc&255,crc>>8);
  let buffer=0,bits=0,result="";
  for(const n of bytes){buffer=(buffer<<8)|n;bits+=8;
    while(bits>=5){bits-=5;result+=ABC[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}}
  if(bits)result+=ABC[(buffer<<(5-bits))&31];
  return result;
}
async function fixture(){
  const r=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  r.contracts.forEach((c,i)=>{
    c.contractId=address(16,10+i);c.status="candidate";
    c.deploymentTxHash=(i+1).toString(16).padStart(64,"a");
    c.verifiedAtLedger=90;
  });
  const wallets={maker:address(48,1),taker:address(48,2),
    borrower:address(48,3),keeper:address(48,4)};
  const steps=M21_STEPS.map((x,i)=>({id:x.id,
    transactionHash:(i+10).toString(16).padStart(64,"0")}));
  const manifest={schemaVersion:1,networkPassphrase:TESTNET_PASSPHRASE,wallets,steps};
  return {r,manifest};
}
function fakeRpc(manifest,options={}){
  const calls=[];
  const rpc=async(method,params)=>{
    calls.push({method,params});
    if(method==="getNetwork")return {passphrase:options.wrongNetwork?"PUBLIC NETWORK":TESTNET_PASSPHRASE};
    if(method==="getHealth")return {status:"healthy",oldestLedger:80,latestLedger:150};
    if(method==="getLatestLedger")return {sequence:150,closeTime:CLOSE};
    if(method==="getTransaction"){
      const i=manifest.steps.findIndex(s=>s.transactionHash===params.hash);
      return {status:options.failStep===i?"FAILED":"SUCCESS",
        txHash:options.wrongHash&&i===0?HASH:params.hash,ledger:100+i,
        envelopeXdr:"AAAAAQ==",resultXdr:options.badXdr&&i===0?"!!":"AAAAAQ==",
        resultMetaXdr:"AAAAAQ=="};
    }
    if(method==="getLedgers")return {ledgers:[{sequence:params.startLedger,
      hash:options.badLedger&&params.startLedger===100?"bad":HASH,
      ledgerCloseTime:CLOSE}]};
    throw Error("Unexpected RPC method "+method);
  };
  return {rpc,calls};
}
const inspect=async()=>({
  envelopeHashVerified:true,sourceWalletSignatureVerified:true,
  invocationTargetVerified:true,financialStateVerified:false,
});
test("M21 actual repository remains blocked by absent candidate contracts and independent audit",async()=>{
  const reg=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  const result=m21Readiness(reg);
  assert.equal(result.state,"BLOCKED_PENDING_INDEPENDENT_TESTNET_DEPLOYMENTS");
  assert.equal(result.missingContractRoles.length,7);
  assert.equal(result.verifiedSignedTransactions,0);
  assert.equal(result.fullLifecycleVerified,false);
});
test("M21 enforces distinct wallets, exact ordered methods, hashes and Testnet",async()=>{
  const {r,manifest}=await fixture();
  assert.equal(validateM21Manifest(manifest,r).steps.length,11);
  for(const altered of [
    {...manifest,networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {...manifest,extra:"true"},
    {...manifest,wallets:{...manifest.wallets,taker:manifest.wallets.maker}},
    {...manifest,steps:manifest.steps.slice(1)},
    {...manifest,steps:[manifest.steps[1],manifest.steps[0],...manifest.steps.slice(2)]},
    {...manifest,steps:manifest.steps.map((s,i)=>i===1?{...s,transactionHash:manifest.steps[0].transactionHash}:s)},
    {...manifest,steps:manifest.steps.map((s,i)=>i===0?{...s,transactionHash:"not-a-hash"}:s)},
  ])assert.throws(()=>validateM21Manifest(altered,r));
  r.contracts[0].status="planned";
  r.contracts[0].contractId=null;r.contracts[0].deploymentTxHash=null;
  r.contracts[0].verifiedAtLedger=null;
  assert.throws(()=>validateM21Manifest(manifest,r),/deployment candidate|M21 still lacks/);
});
test("M21 validates real-record-shaped RPC receipts but NEVER claims end-to-end state",async()=>{
  const {r,manifest}=await fixture(),mock=fakeRpc(manifest);
  const report=await verifyM21Receipts({registry:r,manifest,rpc:mock.rpc,
    inspectEnvelope:inspect,nowMs:NOW});
  assert.equal(report.observedSuccessCount,11);
  assert.equal(report.fullLifecycleVerified,false);
  assert.equal(report.canonicalAssetAndStateDeltasVerified,false);
  assert.equal(report.executionPermitted,false);
  assert.ok(report.receipts.every(x=>x.envelopeSignatureVerified&&x.financialStateVerified===false));
  assert.equal(mock.calls.filter(x=>x.method==="getTransaction").length,11);
  assert.equal(mock.calls.filter(x=>x.method==="sendTransaction").length,0);
});
test("M21 RPC wrong network, hash, failed transaction, result XDR and fork fail closed",async()=>{
  const {r,manifest}=await fixture();
  for(const [options,pattern] of [
    [{wrongNetwork:true},/passphrase/],
    [{wrongHash:true},/hash mismatch/],
    [{failStep:0},/FAILED/],
    [{badXdr:true},/missing transaction result/],
    [{badLedger:true},/missing ledger hash/],
  ]){
    const mock=fakeRpc(manifest,options);
    await assert.rejects(()=>verifyM21Receipts({registry:r,manifest,
      rpc:mock.rpc,inspectEnvelope:inspect,nowMs:NOW}),pattern);
  }
});
test("M21 refuses fake envelope signature and falsely verified financial projection",async()=>{
  const {r,manifest}=await fixture(),mock=fakeRpc(manifest);
  await assert.rejects(()=>verifyM21Receipts({registry:r,manifest,
    rpc:mock.rpc,inspectEnvelope:async()=>({...await inspect(),
      sourceWalletSignatureVerified:false}),nowMs:NOW}),/incomplete/);
  await assert.rejects(()=>verifyM21Receipts({registry:r,manifest,
    rpc:mock.rpc,inspectEnvelope:async()=>({...await inspect(),
      financialStateVerified:true}),nowMs:NOW}),/incomplete/);
});
test("M21 canonical RPC transport allows read methods only, enforces response IDs",async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    assert.equal(url,TESTNET_CONFIG.rpc);
    assert.equal(opts.method,"POST");
    const body=JSON.parse(opts.body);
    calls.push(body.method);
    return {ok:true,json:async()=>({jsonrpc:"2.0",id:body.id,
      result:{passphrase:TESTNET_PASSPHRASE}})};
  };
  const rpc=makeM21Rpc({fetchImpl,timeoutMs:1000});
  await assert.rejects(()=>rpc("sendTransaction",{transaction:"AAAAAQ=="}),/Unapproved/);
  await assert.rejects(()=>rpc("simulateTransaction",{}),/Unapproved/);
  assert.deepEqual(await rpc("getNetwork"),{passphrase:TESTNET_PASSPHRASE});
  assert.deepEqual(calls,["getNetwork"]);
  const bad=makeM21Rpc({fetchImpl:async()=>({ok:true,json:async()=>({
    jsonrpc:"2.0",id:999,result:{passphrase:TESTNET_PASSPHRASE}})})});
  await assert.rejects(()=>bad("getNetwork"),/identity/);
});
