/**
 * M22 reproducible fault injection against local-only event observation and
 * sandbox controls. No real blockchain transactions are created or broadcast.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DurableEventIndex} from "../indexer/store.mjs";
import {RpcLedgerScanner} from "../indexer/rpc.mjs";
import {createM20Controls,createRequestLimiter} from "../security/controls.mjs";
import {makeM21Rpc} from "../verification/m21.mjs";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";
const NOW=1_800_000_000_000;
const SEC=String(Math.floor((NOW-5000)/1000));
const CLOSE=new Date(Number(SEC)*1000).toISOString();
const HEX="a".repeat(64);
const ALT="b".repeat(64);
function address(seed){
  const ABC="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes=[16,...Array(32).fill(seed)];
  let crc=0;
  for(const b of bytes){crc^=b<<8;for(let i=0;i<8;i++)
    crc=crc&32768?((crc<<1)^0x1021)&65535:(crc<<1)&65535;}
  bytes.push(crc&255,crc>>8);
  let buffer=0,bits=0,result="";
  for(const n of bytes){
    buffer=(buffer<<8)|n;bits+=8;
    while(bits>=5){bits-=5;result+=ABC[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}}
  if(bits)result+=ABC[(buffer<<(5-bits))&31];
  return result;
}
const CONTRACTS=[{role:"collateral-vault",contractId:address(7)}];
const checkpoint=(ledger,hash=HEX)=>({ledger,ledgerHash:hash,closeTime:CLOSE,events:[]});
async function pathFor(t){
  const dir=await mkdtemp(join(tmpdir(),"hoxo-m22-chaos-"));
  t.after(async()=>rm(dir,{recursive:true,force:true}));
  return join(dir,"observations.jsonl");
}
test("M22 injected disk write failure halts journal, retains last checkpoint and refuses later commits",async t=>{
  const path=await pathFor(t);
  const store=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  await store.commit(checkpoint(100));
  const original=await readFile(path,"utf8");
  const realFile=store.file;
  store.file={writeFile:async()=>{throw Error("ENOSPC injected disk exhaustion");},
    sync:()=>realFile.sync(),close:()=>realFile.close()};
  await assert.rejects(()=>store.commit(checkpoint(101)),/durable checkpoint write failed; halted/);
  assert.equal(store.status.state,"HALTED");
  assert.equal(store.status.latestScannedLedger,100);
  await assert.rejects(()=>store.commit(checkpoint(101)),/unavailable/);
  store.file=realFile;await store.close();
  assert.equal(await readFile(path,"utf8"),original);
  const reloaded=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  assert.equal(reloaded.status.latestScannedLedger,100);
  await reloaded.close();
});
test("M22 checkpoint mutation and partial/crash row fail closed at restart, never auto-repair",async t=>{
  const path=await pathFor(t);
  let store=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  await store.commit(checkpoint(100));
  await store.commit(checkpoint(101));
  await store.close();
  const original=await readFile(path,"utf8");
  await writeFile(path,original.replace('"ledgerHash":"'+HEX+'"','"ledgerHash":"'+ALT+'"'));
  await assert.rejects(()=>DurableEventIndex.open(path,{contracts:CONTRACTS}),/hash-chain/);
  await writeFile(path,original+"{\"version\":1,\"unfinished\":true");
  await assert.rejects(()=>DurableEventIndex.open(path,{contracts:CONTRACTS}),/incomplete/);
  assert.equal((await readFile(path,"utf8")).endsWith("\n"),false);
  await writeFile(path,original);
  store=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  assert.equal(store.status.checkpointCount,2);
  await store.close();
});
test("M22 RPC outage mid-scan causes permanent HALT and zero phantom observations",async t=>{
  const path=await pathFor(t);
  const store=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  const calls=[];
  const rpc=async(method,params={})=>{
    calls.push(method);
    if(method==="getNetwork")return {passphrase:TESTNET_PASSPHRASE};
    if(method==="getHealth")return {status:"healthy",oldestLedger:90,latestLedger:100};
    if(method==="getLatestLedger")return {sequence:100,closeTime:SEC};
    if(method==="getLedgers")return {ledgers:[{sequence:params.startLedger,
      hash:HEX,ledgerCloseTime:SEC}]};
    if(method==="getEvents")throw Error("Injected 503 upstream RPC timeout");
    throw Error("Unsupported request");
  };
  const scanner=new RpcLedgerScanner({store,rpc,now:()=>NOW,startLedger:100});
  await assert.rejects(()=>scanner.poll(),/Injected 503/);
  assert.equal(scanner.halted,true);
  assert.equal(store.status.checkpointCount,0);
  assert.equal(store.status.reportedEvents,0);
  assert.equal(scanner.status.tradingEnabled,false);
  await assert.rejects(()=>scanner.poll(),/halted/);
  assert.equal(calls.filter(x=>x==="getEvents").length,1);
  await store.close();
});
test("M22 ledger fork during scan fails before checkpoint commit",async t=>{
  const path=await pathFor(t);
  const store=await DurableEventIndex.open(path,{contracts:CONTRACTS});
  let headers=0;
  const rpc=async(method,params={})=>{
    if(method==="getNetwork")return {passphrase:TESTNET_PASSPHRASE};
    if(method==="getHealth")return {status:"healthy",oldestLedger:90,latestLedger:100};
    if(method==="getLatestLedger")return {sequence:100,closeTime:SEC};
    if(method==="getLedgers")return {ledgers:[{sequence:params.startLedger,
      hash:++headers===1?HEX:ALT,ledgerCloseTime:SEC}]};
    if(method==="getEvents")return {oldestLedger:90,latestLedger:100,events:[]};
    throw Error("Unsupported read");
  };
  const scanner=new RpcLedgerScanner({store,rpc,now:()=>NOW,startLedger:100});
  await assert.rejects(()=>scanner.poll(),/Ledger changed during M19 event scan/);
  assert.equal(scanner.halted,true);
  assert.equal(store.status.reportedEvents,0);
  assert.equal(store.status.latestScannedLedger,null);
  await store.close();
});
test("M22 operator oracle kill switch refuses new price-dependent commands after outage",()=>{
  const {gate,operator}=createM20Controls({
    sandboxPaused:false,oraclePaused:false,indexerPaused:true,
  });
  assert.equal(gate.assertSandboxCommand({type:"advanced_place"}),true);
  operator.setPause("oracle",true,"M22 injected oracle equivocation incident");
  for(const type of ["place","replace","advanced_place","sandbox_tick"]){
    assert.throws(()=>gate.assertSandboxCommand({type}),/oracle circuit breaker/);
  }
  assert.equal(gate.assertSandboxCommand({type:"cancel"}),true);
  assert.equal(gate.status().executionPermitted,false);
  assert.equal(gate.canObserve(),false);
});
test("M22 limiter does not bypass rate budget after time rollback or header spoof",()=>{
  const limiter=createRequestLimiter({perKeyLimit:2,globalLimit:3,maxKeys:2,windowMs:1000});
  assert.equal(limiter.take("127.0.0.1",NOW).allowed,true);
  assert.equal(limiter.take("127.0.0.1",NOW+1).allowed,true);
  assert.equal(limiter.take("127.0.0.1",NOW-2000).allowed,false);
  assert.equal(limiter.take("127.0.0.2",NOW+2).allowed,false);
  assert.equal(limiter.take("127.0.0.3",NOW+3).allowed,false);
});
test("M22 M21 RPC transport refuses transaction sends and fails on upstream identity/outage",async()=>{
  const calls=[];
  const bad=makeM21Rpc({fetchImpl:async (url,opts)=>{
    assert.equal(url,TESTNET_CONFIG.rpc);
    const req=JSON.parse(opts.body);calls.push(req.method);
    throw Error("Injected network outage");
  }});
  await assert.rejects(()=>bad("getTransaction",{hash:HEX}),/network outage/);
  await assert.rejects(()=>bad("sendTransaction",{transaction:"AAAAAQ=="}),/Unapproved read-only RPC method/);
  await assert.rejects(()=>bad("restoreFootprint",{}),/Unapproved read-only RPC method/);
  assert.deepEqual(calls,["getTransaction"]);
});
