import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";
import {registryFingerprint,validateEvent,DurableEventIndex} from "../indexer/store.mjs";
import {RpcLedgerScanner,makeRpcClient,validateIndexerNetwork} from "../indexer/rpc.mjs";
import {createIndexerApi} from "../indexer/api.mjs";
import {validateRegistry} from "../infra/registry.mjs";
const NOW=Date.parse("2026-10-31T17:00:00Z");
const SEC=String(Math.floor((NOW-5_000)/1_000));
const CLOSE=new Date(Number(SEC)*1000).toISOString();
const HEX="abcdef0123456789";
const HASH="a".repeat(64);
const OLD="b".repeat(64);
const ABC="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function contractId(seed){
  const bytes=Buffer.concat([Buffer.from([16]),Buffer.alloc(32,seed)]);
  let crc=0;
  for(const byte of bytes){
    crc^=byte<<8;
    for(let i=0;i<8;i++)crc=crc&32768?((crc<<1)^0x1021)&65535:(crc<<1)&65535;
  }
  const all=Buffer.concat([bytes,Buffer.from([crc&255,crc>>8])]);
  let buffer=0,bits=0,value="";
  for(const n of all){
    buffer=(buffer<<8)|n;bits+=8;
    while(bits>=5){bits-=5;value+=ABC[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}
  }
  if(bits)value+=ABC[(buffer<<(5-bits))&31];
  return value;
}
const C1=contractId(1),C2=contractId(2);
const contracts=[{role:"unified-margin",contractId:C1},
  {role:"perp-clearinghouse",contractId:C2}];
function event(ledger,contract=C1,idx=0){
  return {type:"contract",ledger,contractId:contract,
    id:String(ledger).padStart(18,"0")+"-"+String(idx).padStart(10,"0"),
    txHash:HASH,ledgerClosedAt:CLOSE,
    topic:["AAAAAQ=="],value:"AAAAAQ==",inSuccessfulContractCall:true};
}
const checkpoint=(ledger,events=[])=>({
  ledger,ledgerHash:HASH,closeTime:CLOSE,events
});
async function temporary(t){
  const folder=await mkdtemp(join(tmpdir(),"hoxo-m19-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return join(folder,"indexer.jsonl");
}
function provider({
  latest=102,oldest=95,badNetwork=false,healthStatus="healthy",
  headTime=SEC,eventsByLedger={},hashes={},wrongCoverage=false,
  changeOnRead=null,
}={}){
  let ledgerCalls=0;
  const calls=[];
  const rpc=async(method,params={})=>{
    calls.push({method,params});
    if(method==="getNetwork")return {passphrase:badNetwork?"Mainnet":TESTNET_PASSPHRASE};
    if(method==="getHealth")return {
      status:healthStatus,oldestLedger:oldest,latestLedger:latest,
    };
    if(method==="getLatestLedger")return {sequence:latest,closeTime:headTime};
    if(method==="getLedgers"){
      ledgerCalls++;
      const sequence=params.startLedger;
      const hash=changeOnRead?.(sequence,ledgerCalls)??hashes[sequence]??HASH;
      return {latestLedger:latest,oldestLedger:oldest,
        ledgers:[{sequence,hash,ledgerCloseTime:SEC}]};
    }
    if(method==="getEvents"){
      const sequence=params.startLedger??Number(params.pagination.cursor?.split("-")[0]);
      return {latestLedger:latest,oldestLedger:wrongCoverage?sequence+1:oldest,
        cursor:String(sequence)+"-0000000001",
        events:eventsByLedger[sequence]??[]};
    }
    throw Error("Unmocked RPC method");
  };
  return {rpc,calls};
}
test("M19 deployed registry remains empty and no contract can be self-declared verified",async()=>{
  const registry=JSON.parse(await readFile(
    new URL("../registry/testnet.json",import.meta.url),"utf8"));
  const summary=validateRegistry(registry);
  assert.equal(summary.deployedVerified,0);
  assert.equal(summary.candidateContracts,0);
  assert.ok(summary.statuses.every(x=>x.status==="planned"&&x.contractId===null));
});
test("M19 only accepts correct candidate Stellar contract IDs and stable allowlist fingerprint",()=>{
  const one=registryFingerprint(contracts);
  assert.equal(one,registryFingerprint([...contracts].reverse()));
  assert.equal(one.length,64);
  assert.throws(()=>registryFingerprint([]),/nonempty/);
  assert.throws(()=>registryFingerprint([{role:"x",contractId:"GFAKE"}]),/Invalid/);
  assert.throws(()=>registryFingerprint([...contracts,contracts[0]]),/Duplicated/);
});
test("M19 validates only in-scope successful contract events with raw ScVal provenance",()=>{
  const normalized=validateEvent(event(100),100,contracts);
  assert.equal(normalized.role,"unified-margin");
  assert.equal(normalized.txVerifiedIndependently,false);
  assert.equal(normalized.financialStateDerived,false);
  assert.equal(normalized.onchainReported,true);
  assert.deepEqual(normalized.topic,["AAAAAQ=="]);
  for(const bad of [
    {...event(100),type:"diagnostic"},
    event(100,contractId(11)),
    {...event(100),ledger:101},
    {...event(100),txHash:"not-hash"},
    {...event(100),value:"!unsafe"},
    {...event(100),topic:[]},
    {...event(100),inSuccessfulContractCall:false},
  ])assert.throws(()=>validateEvent(bad,100,contracts));
});
test("M19 checkpoint journal persists empty ledgers and candidate events atomically",async t=>{
  const path=await temporary(t);
  let store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100));
  await store.commit(checkpoint(101,[event(101),event(101,C2,1)]));
  assert.equal(store.status.latestScannedLedger,101);
  assert.equal(store.status.reportedEvents,2);
  assert.equal(store.status.independentlyVerifiedDeployments,0);
  assert.equal(store.status.hoxoFinancialAccountingAvailable,false);
  const hash=store.lastHash;
  const page=store.listEvents({role:"perp-clearinghouse"});
  assert.equal(page.items.length,1);
  assert.equal(page.items[0].contractId,C2);
  await store.close();
  store=await DurableEventIndex.open(path,{contracts});
  assert.equal(store.lastHash,hash);
  assert.equal(store.status.checkpointCount,2);
  assert.equal(store.listEvents({role:"unified-margin"}).items.length,1);
  await store.close();
});
test("M19 refuses incorrect contract set or tampered event after restart",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100,[event(100)]));
  await store.close();
  await assert.rejects(()=>DurableEventIndex.open(path,{contracts:[contracts[0]]}),
    /contract-set mismatch/);
  const original=await readFile(path,"utf8");
  await writeFile(path,original.replace('"value":"AAAAAQ=="','"value":"AAAAAg=="'));
  await assert.rejects(()=>DurableEventIndex.open(path,{contracts}),/hash-chain/);
});
test("M19 missing newline journal corruption is rejected; no automatic truncation",async t=>{
  const path=await temporary(t);
  let store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100));
  await store.close();
  const data=await readFile(path,"utf8");
  await writeFile(path,data.trimEnd());
  await assert.rejects(()=>DurableEventIndex.open(path,{contracts}),/incomplete/);
  assert.equal((await readFile(path,"utf8")).endsWith("\n"),false);
});
test("M19 duplicate IDs, gaps and wrong-ledger events never commit",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100,[event(100)]));
  await assert.rejects(()=>store.commit(checkpoint(102)),/gap/);
  await assert.rejects(()=>store.commit(checkpoint(101,[event(100)])),/Invalid event ledger/);
  await assert.rejects(()=>store.commit(checkpoint(101,[event(101),event(101)])),/Duplicate/);
  assert.equal(store.status.latestScannedLedger,100);
  assert.equal(store.status.reportedEvents,1);
  await store.close();
});
test("M19 caller cannot mutate stored data through paginated event projections",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100,[event(100),event(100,C2,1)]));
  const one=store.listEvents({limit:1});
  assert.equal(one.nextCursor,1);
  one.items[0].topic[0]="ATTACK";
  const two=store.listEvents({cursor:1,limit:1});
  assert.equal(two.items[0].contractId,C2);
  assert.equal(store.listEvents({role:"unified-margin"}).items[0].topic[0],"AAAAAQ==");
  assert.throws(()=>store.listEvents({limit:101}),/pagination/);
  assert.throws(()=>store.listEvents({role:"unknown"}),/Unregistered/);
  await store.close();
});
test("M19 validates live RPC exact network, retention and close-time freshness",()=>{
  const valid=validateIndexerNetwork({passphrase:TESTNET_PASSPHRASE},
    {status:"healthy",oldestLedger:95,latestLedger:102},
    {sequence:102,closeTime:SEC},NOW);
  assert.equal(valid.latestLedger,102);
  assert.throws(()=>validateIndexerNetwork({passphrase:"Mainnet"},
    {status:"healthy",oldestLedger:95,latestLedger:102},
    {sequence:102,closeTime:SEC},NOW),/mismatch/);
  assert.throws(()=>validateIndexerNetwork({passphrase:TESTNET_PASSPHRASE},
    {status:"healthy",oldestLedger:95,latestLedger:102},
    {sequence:102,closeTime:"1000000000"},NOW),/stale/);
});
test("M19 canonical RPC request validates request IDs across simultaneous calls",async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    assert.equal(url,TESTNET_CONFIG.rpc);
    const req=JSON.parse(opts.body);calls.push(req);
    await Promise.resolve();
    return {ok:true,json:async()=>({
      jsonrpc:"2.0",id:req.id,result:{passphrase:TESTNET_PASSPHRASE}
    })};
  };
  const rpc=makeRpcClient({fetchImpl});
  await Promise.all([rpc("getNetwork"),rpc("getNetwork")]);
  assert.deepEqual(calls.map(x=>x.id),[1,2]);
  assert.throws(()=>makeRpcClient({fetchImpl,url:"https://evil.example"}),/canonical/);
  await assert.rejects(()=>rpc("sendTransaction"),/Unsupported read-only/);
});
test("M19 one poll scans bounded ledgers with RPC hash anchors and explicit event filter",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  const mock=provider({latest:102,eventsByLedger:{101:[event(101)],102:[event(102,C2)]}});
  const scanner=new RpcLedgerScanner({store,rpc:mock.rpc,now:()=>NOW,startLedger:101});
  const result=await scanner.poll();
  assert.equal(result.latestScannedLedger,102);
  assert.equal(result.reportedEvents,2);
  const eventRequests=mock.calls.filter(x=>x.method==="getEvents");
  assert.equal(eventRequests.length,2);
  assert.deepEqual(eventRequests[0].params.filters[0].contractIds,[C1,C2]);
  assert.equal(eventRequests[0].params.endLedger,102);
  assert.equal(mock.calls.filter(x=>x.method==="getLedgers").length,4);
  await scanner.poll();
  assert.equal(store.status.checkpointCount,2);
  await store.close();
});
test("M19 restart re-checks checkpoint hash; divergence permanently halts scanner",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100,[event(100)]));
  const mock=provider({latest:102,hashes:{100:OLD}});
  const scanner=new RpcLedgerScanner({store,rpc:mock.rpc,now:()=>NOW});
  await assert.rejects(()=>scanner.poll(),/hash divergence/);
  assert.equal(scanner.status.scannerHalted,true);
  await assert.rejects(()=>scanner.poll(),/halted/);
  assert.equal(store.status.latestScannedLedger,100);
  await store.close();
});
test("M19 network reset, missing retention and wrong passphrase halt without gap-filling",async t=>{
  for(const options of [
    {latest:99,oldest:90},
    {latest:102,oldest:101},
    {latest:102,oldest:95,badNetwork:true},
  ]){
    const path=await temporary(t);
    const store=await DurableEventIndex.open(path,{contracts});
    await store.commit(checkpoint(100));
    const m=provider(options);
    const scanner=new RpcLedgerScanner({store,rpc:m.rpc,now:()=>NOW});
    await assert.rejects(()=>scanner.poll());
    assert.equal(scanner.status.scannerHalted,true);
    assert.equal(store.status.latestScannedLedger,100);
    await store.close();
  }
});
test("M19 insufficient RPC event coverage blocks commit and reports scanner failure",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  const m=provider({latest:102,wrongCoverage:true});
  const scanner=new RpcLedgerScanner({store,rpc:m.rpc,now:()=>NOW,startLedger:101});
  await assert.rejects(()=>scanner.poll(),/coverage/);
  assert.equal(store.status.latestScannedLedger,null);
  await store.close();
});
test("M19 mid-ledger hash change fails and does not commit a forked checkpoint",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  const m=provider({latest:101,
    changeOnRead:(_,count)=>count===1?HASH:OLD});
  const scanner=new RpcLedgerScanner({store,rpc:m.rpc,now:()=>NOW,startLedger:101});
  await assert.rejects(()=>scanner.poll(),/changed during/);
  assert.equal(store.status.reportedEvents,0);
  await store.close();
});
test("M19 read-only API defaults to DISABLED and never calls RPC or claims financial data",async()=>{
  const server=createIndexerApi({now:()=>NOW});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const origin="http://127.0.0.1:"+server.address().port;
  try{
    const status=await (await fetch(origin+"/v1/indexer/status")).json();
    assert.equal(status.state,"DISABLED_NO_VERIFIED_DEPLOYMENTS");
    assert.equal(status.tradingEnabled,false);
    assert.equal(status.independentlyVerifiedDeployments,0);
    assert.equal(status.hoxoFinancialAccountingAvailable,false);
    const history=await (await fetch(origin+"/v1/indexer/events")).json();
    assert.deepEqual(history.items,[]);
    assert.equal(history.source,"DISABLED");
    const denied=await fetch(origin+"/v1/indexer/events",{method:"POST"});
    assert.equal(denied.status,405);
    const absent=await fetch(origin+"/v1/indexer/settle");
    assert.equal(absent.status,404);
  }finally{
    server.closeAllConnections();
    await new Promise(r=>server.close(r));
  }
});
test("M19 event and checkpoint REST pagination remains public, read-only and labeled candidate",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  await store.commit(checkpoint(100,[event(100),event(100,C2,1)]));
  const server=createIndexerApi({store,now:()=>NOW});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const origin="http://127.0.0.1:"+server.address().port;
  try{
    const one=await (await fetch(origin+"/v1/indexer/events?limit=1")).json();
    assert.equal(one.items.length,1);
    assert.equal(one.nextCursor,1);
    assert.equal(one.items[0].txVerifiedIndependently,false);
    const second=await (await fetch(origin+"/v1/indexer/events?cursor=1&limit=1")).json();
    assert.equal(second.items[0].role,"perp-clearinghouse");
    const meta=await (await fetch(origin+"/v1/indexer/checkpoints")).json();
    assert.equal(meta.items[0].reportedEventCount,2);
    assert.equal(meta.independentlyVerified,false);
    assert.equal((await fetch(origin+"/v1/indexer/events?cursor=-1")).status,400);
    assert.equal((await fetch(origin+"/v1/indexer/events?role=unknown")).status,400);
    assert.equal((await fetch(origin+"/v1/indexer/transactions",{method:"POST"})).status,405);
  }finally{
    server.closeAllConnections();
    await new Promise(r=>server.close(r));
    await store.close();
  }
});
test("M19 append checkpoints publish deterministic live notification without speculative trades",async t=>{
  const path=await temporary(t);
  const store=await DurableEventIndex.open(path,{contracts});
  const received=[];
  const un=store.subscribe(x=>received.push(x));
  await store.commit(checkpoint(100,[event(100)]));
  un();
  await store.commit(checkpoint(101));
  assert.deepEqual(received.map(x=>x.ledger),[100]);
  assert.equal(received[0].provenance,"CANDIDATE_OBSERVATION_ONLY");
  assert.equal(store.status.executionPermitted,false);
  await store.close();
});
