import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {
  validateTestnetCodeManifest,verifyTestnetCode,createLiveCodeVerificationServer,
  loadReviewedTestnetWasm
} from "../verification/testnet-code.mjs";

const ALPHA="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function address(seed){
  const b=[16,...Array(32).fill(seed)];
  let crc=0;
  for(const x of b){
    crc^=x<<8;
    for(let i=0;i<8;i++)
      crc=crc&0x8000?((crc<<1)^0x1021)&65535:(crc<<1)&65535);
  }
  b.push(crc&255,crc>>8);
  let value=0,bits=0,out="";
  for(const x of b){
    value=(value<<8)|x;bits+=8;
    while(bits>=5){bits-=5;out+=ALPHA[(value>>>bits)&31];value&=(1<<bits)-1;}
  }
  if(bits)out+=ALPHA[(value<<(5-bits))&31];
  return out;
}
const TIME=1800000000000;
const CLOSE=String(Math.floor((TIME-10_000)/1000));
const A="a".repeat(64),B="b".repeat(64);
const bytes=Buffer.from([0,97,115,109,1,0,0,0,1,2,3,4,5,6]);
function manifest(entries=[{role:"spot-settlement",contractId:address(10),deploymentTxHash:A}]){
  return {schemaVersion:1,networkPassphrase:TESTNET_PASSPHRASE,contracts:entries};
}
function rpc(overrides={}){
  const calls=[];
  const server={
    getNetwork:async()=>{calls.push("getNetwork");return {passphrase:TESTNET_PASSPHRASE};},
    getHealth:async()=>{calls.push("getHealth");return {status:"healthy"};},
    getLatestLedger:async()=>{calls.push("getLatestLedger");return {sequence:999,closeTime:CLOSE};},
    getContractWasmByContractId:async()=>{calls.push("getContractWasmByContractId");return bytes;},
    getTransaction:async hash=>{calls.push("getTransaction");return {
      txHash:hash,status:"SUCCESS",ledger:100,resultXdr:"fake"
    }},
    ...overrides
  };
  return {server,calls};
}
const verifier=({config=manifest(),server=rpc().server,readWasm=async()=>bytes,nowMs=TIME}={})=>
  verifyTestnetCode({manifest:config,server,readWasm,nowMs});

test("read-only proof validates real Hoxo source inventory and refuses unknown or duplicated contracts",()=>{
  assert.equal(validateTestnetCodeManifest(manifest()).contracts[0].wasm,"hoxo_spot_settlement.wasm");
  for(const bad of [
    {...manifest(),networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {...manifest(),schemaVersion:2},
    {...manifest(),contracts:[]},
    {...manifest(),contracts:[...manifest().contracts,...manifest().contracts]},
    manifest([{role:"unsafe-financial-mainnet",contractId:address(10),deploymentTxHash:A}]),
    manifest([{role:"spot-settlement",contractId:"CCNOTREAL",deploymentTxHash:A}]),
    manifest([{role:"spot-settlement",contractId:address(10),deploymentTxHash:"g".repeat(64)}]),
    {...manifest(),operatorPrivateSeed:"NOT_ALLOWED"}
  ])assert.throws(()=>validateTestnetCodeManifest(bad));
});
test("read-only verifier independently hashes current on-chain WASM, but never grants beta or invents receipt linkage",async()=>{
  const c=rpc();
  const v=await verifier({server:c.server});
  assert.equal(v.verifiedWasmMatches,1);
  assert.equal(v.contracts[0].role,"spot-settlement");
  assert.equal(v.contracts[0].localWasmSha256,createHash("sha256").update(bytes).digest("hex"));
  assert.equal(v.contracts[0].sourceAndOnchainCodeMatch,true);
  assert.equal(v.contracts[0].providerReportsTransactionSuccess,true);
  assert.equal(v.contracts[0].deploymentTransactionLinkedToContract,false);
  assert.equal(v.contracts[0].adminOrConstructorArgsVerified,false);
  assert.equal(v.contracts[0].financialBetaAuthorized,false);
  assert.equal(v.deploymentProven,false);
  assert.equal(v.realTradingVerified,false);
  assert.equal(v.permissionToOpenFinancialBeta,false);
  assert.equal(v.permissionToOpenMainnet,false);
  assert.ok(c.calls.includes("getContractWasmByContractId"));
  assert.ok(c.calls.includes("getTransaction"));
  assert.ok(!c.calls.includes("sendTransaction"));
});
test("multiple different roles and approved C-addresses share actual chain RPC observations",async()=>{
  const m=manifest([
    {role:"spot-settlement",contractId:address(10),deploymentTxHash:A},
    {role:"money-market",contractId:address(11),deploymentTxHash:B},
  ]);
  const v=await verifier({config:m});
  assert.equal(v.verifiedWasmMatches,2);
  assert.equal(v.contracts.length,2);
  assert.ok(v.contracts.every(c=>c.sourceAndOnchainCodeMatch&&!c.financialBetaAuthorized));
});
test("wrong network, stale clock and unhealthy RPC reject before reading contracts or claims",async()=>{
  for(const overrides of [
    {getNetwork:async()=>({passphrase:"Public Global Stellar Network ; September 2015"})},
    {getHealth:async()=>({status:"unhealthy"})},
    {getLatestLedger:async()=>({sequence:0,closeTime:CLOSE})},
    {getLatestLedger:async()=>({sequence:50,closeTime:String(Math.floor((TIME-500000)/1000))})},
    {getLatestLedger:async()=>({sequence:50,closeTime:String(Math.floor((TIME+10000)/1000))})},
  ]){
    const c=rpc(overrides);
    await assert.rejects(verifier({server:c.server}));
    assert.ok(!c.calls.includes("getContractWasmByContractId"));
  }
});
test("different installed bytecode, incorrect transaction hash and failed tx all refuse evidence",async()=>{
  const corrupted=Buffer.from(bytes);corrupted[9]=99;
  for(const overrides of [
    {getContractWasmByContractId:async()=>corrupted},
    {getContractWasmByContractId:async()=>Buffer.from([0,0,0])},
    {getTransaction:async()=>({status:"FAILED",txHash:A,ledger:100})},
    {getTransaction:async()=>({status:"SUCCESS",txHash:B,ledger:100})},
    {getTransaction:async()=>({status:"SUCCESS",txHash:A,ledger:1001})},
    {getTransaction:async()=>({status:"NOT_FOUND"})},
    {getContractWasmByContractId:async()=>{throw Error("Missing contract");}},
  ])await assert.rejects(verifier({server:rpc(overrides).server}));
});
test("malformed local file and absent sdk network client fail closed",async()=>{
  await assert.rejects(verifier({readWasm:async()=>Buffer.from([0,97,115,109,1,0,0,0])}));
  await assert.rejects(verifier({server:{}}));
  await assert.rejects(createLiveCodeVerificationServer({sdk:{}}));
  const mockSdk={rpc:{Server:class {
    constructor(url,options){this.url=url;this.options=options;}
  }}};
  const server=await createLiveCodeVerificationServer({sdk:mockSdk});
  assert.match(server.url,/testnet/);
  assert.equal(server.options.allowHttp,false);
});
test("WASM loader forbids path traversal, symlinks, malformed artifacts and nonexistent roots",async()=>{
  await assert.rejects(loadReviewedTestnetWasm({wasmDirectory:"",role:"spot-settlement"}));
  await assert.rejects(loadReviewedTestnetWasm({wasmDirectory:"/review",role:"not-a-role"}));
  const fakeStat={isFile:()=>true,isSymbolicLink:()=>false,size:bytes.length};
  const data=await loadReviewedTestnetWasm({wasmDirectory:"/review",role:"spot-settlement",
    real:async()=>"/review",stat:async()=>fakeStat,read:async()=>bytes});
  assert.deepEqual(data,bytes);
  await assert.rejects(loadReviewedTestnetWasm({wasmDirectory:"/review",role:"spot-settlement",
    real:async()=>"/review",stat:async()=>({...fakeStat,isSymbolicLink:()=>true}),
    read:async()=>bytes}));
  await assert.rejects(loadReviewedTestnetWasm({wasmDirectory:"/review",role:"spot-settlement",
    real:async()=>"/review",stat:async()=>fakeStat,read:async()=>Buffer.alloc(bytes.length)}));
});
test("real repo registry still has no independently deployed Hoxo addresses or evidence",async()=>{
  const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  assert.equal(registry.contracts.length,7);
  assert.ok(registry.contracts.every(c=>c.status==="planned"&&c.contractId===null&&
    c.deploymentTxHash===null));
});
