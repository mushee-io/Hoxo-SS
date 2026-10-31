import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TESTNET_CONFIG,DEFAULT_ENDPOINTS,TESTNET_PASSPHRASE,normaliseEndpoint,makeTestnetConfig} from "../config/testnet.mjs";
import {probeRpc,probeHorizon,probeInfrastructure,reconcileEndpoints,validateRpcResult} from "../infra/network.mjs";
import {validateRegistry,isStellarContractId} from "../infra/registry.mjs";

const NOW=Date.parse("2026-10-31T09:20:00Z");
const SEC=String(Math.floor((NOW-5000)/1000));
const HSEQ=6000000;
const root=()=>({network_passphrase:TESTNET_PASSPHRASE,history_latest_ledger:HSEQ,history_latest_ledger_closed_at:new Date(NOW-5000).toISOString()});
const network=()=>({passphrase:TESTNET_PASSPHRASE,protocolVersion:23});
const health=()=>({status:"healthy",latestLedger:HSEQ,oldestLedger:HSEQ-100,latestLedgerCloseTime:SEC,ledgerRetentionWindow:120960});
const latest=()=>({sequence:HSEQ,closeTime:SEC,protocolVersion:23});
function responses({rpcNetwork=network(),rpcHealth=health(),rpcLatest=latest(),horizon=root(),throwRpc=false,throwHorizon=false}={}){
  const calls=[];
  const fn=async(url,opts)=>{
    calls.push([url,opts?.method]);
    if(url===TESTNET_CONFIG.horizon+"/"){
      if(throwHorizon)throw Error("offline horizon");
      return {ok:true,json:async()=>horizon};
    }
    if(url===TESTNET_CONFIG.rpc){
      if(throwRpc)throw Error("offline rpc");
      const body=JSON.parse(opts.body);
      assert.equal(body.jsonrpc,"2.0");
      assert.ok(["getNetwork","getHealth","getLatestLedger"].includes(body.method));
      const result={getNetwork:rpcNetwork,getHealth:rpcHealth,getLatestLedger:rpcLatest}[body.method];
      return {ok:true,json:async()=>({jsonrpc:"2.0",id:body.id,result})};
    }
    throw Error("Unknown network URL "+url);
  };
  return {fn,calls};
}
test("M4 canonical endpoints and passphrase are fixed for Testnet",()=>{
  assert.equal(DEFAULT_ENDPOINTS.rpc,"https://soroban-testnet.stellar.org");
  assert.equal(DEFAULT_ENDPOINTS.horizon,"https://horizon-testnet.stellar.org");
  assert.equal(TESTNET_CONFIG.network,"testnet");
  assert.equal(TESTNET_CONFIG.passphrase,"Test SDF Network ; September 2015");
});
test("M4 configurable HTTPS endpoints reject credentials, mainnet and insecure protocols",()=>{
  for(const bad of ["http://example.com","https://user:password@rpc.example.com","https://localhost:8000",
    "https://soroban-mainnet.stellar.org","https://rpc-futurenet.stellar.org","https://rpc.example.com?secret=x"]){
    assert.throws(()=>normaliseEndpoint(bad,{service:"RPC"}),/requires|may not|URL/);
  }
  const config=makeTestnetConfig({rpc:"https://rpc.provider.example/v1/",horizon:"https://horizon.provider.example"});
  assert.equal(config.rpc,"https://rpc.provider.example/v1");
  assert.equal(config.passphrase,TESTNET_PASSPHRASE);
});
test("M4 RPC protocol validates health, network and fresh ledger",()=>{
  const verified=validateRpcResult({network:network(),health:health(),latest:latest()},NOW);
  assert.equal(verified.state,"verified");
  assert.equal(verified.ledger,HSEQ);
  assert.equal(verified.protocolVersion,23);
});
test("M4 RPC mismatch, degraded health, stale and missing ledger fail closed",()=>{
  assert.equal(validateRpcResult({network:{passphrase:"Public Global Stellar Network ; September 2015"},health:health(),latest:latest()},NOW).state,"mismatch");
  assert.equal(validateRpcResult({network:network(),health:{...health(),status:"unhealthy"},latest:latest()},NOW).state,"degraded");
  assert.equal(validateRpcResult({network:network(),health:health(),latest:{...latest(),closeTime:"1000000000"}},NOW).state,"stale");
  assert.equal(validateRpcResult({network:network(),health:health(),latest:{...latest(),sequence:0}},NOW).state,"unavailable");
  assert.equal(validateRpcResult({network:network(),health:health(),latest:{...latest(),sequence:HSEQ-50}},NOW).state,"degraded");
});
test("M4 real RPC client calls getNetwork before health + latest ledger",async()=>{
  const m=responses();
  const result=await probeRpc({fetchImpl:m.fn,nowMs:NOW});
  assert.equal(result.state,"verified");
  assert.equal(m.calls[0][0],TESTNET_CONFIG.rpc);
  assert.deepEqual(m.calls.map(x=>x[1]),["POST","POST","POST"]);
});
test("M4 wrong RPC passphrase stops follow-up calls",async()=>{
  const m=responses({rpcNetwork:{passphrase:"not testnet"}});
  const result=await probeRpc({fetchImpl:m.fn,nowMs:NOW});
  assert.equal(result.state,"mismatch");
  assert.equal(m.calls.length,1);
});
test("M4 Horizon root independently validates actual Testnet network",async()=>{
  const m=responses();
  assert.equal((await probeHorizon({fetchImpl:m.fn,nowMs:NOW})).state,"verified");
  const wrong=responses({horizon:{...root(),network_passphrase:"Public Global Stellar Network ; September 2015"}});
  assert.equal((await probeHorizon({fetchImpl:wrong.fn,nowMs:NOW})).state,"mismatch");
});
test("M4 combined diagnostics reconcile consistent Testnet ledgers",async()=>{
  const m=responses();
  const result=await probeInfrastructure({fetchImpl:m.fn,nowMs:NOW});
  assert.equal(result.state,"verified");
  assert.equal(result.ledgerDelta,0);
  assert.equal(m.calls.length,4);
});
test("M4 infrastructure fails closed if RPC is unreachable or significantly behind",async()=>{
  const offline=responses({throwRpc:true});
  const result=await probeInfrastructure({fetchImpl:offline.fn,nowMs:NOW});
  assert.equal(result.state,"unavailable");
  const lag=responses({rpcLatest:{...latest(),sequence:HSEQ-60},rpcHealth:{...health(),latestLedger:HSEQ-60}});
  const behind=await probeInfrastructure({fetchImpl:lag.fn,nowMs:NOW});
  assert.equal(behind.state,"out-of-sync");
  assert.equal(behind.ledgerDelta,60);
});
test("M4 never calls itself ready based only on Horizon",()=>{
  assert.equal(reconcileEndpoints({state:"verified",ledger:HSEQ},{state:"unavailable"}).state,"unavailable");
});
const load=async()=>JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
test("M4 registry starts with only native XLM and NO deployed contracts",async()=>{
  const data=await load();
  const summary=validateRegistry(data);
  assert.equal(summary.network,"testnet");
  assert.equal(summary.assetCount,1);
  assert.equal(summary.candidateContracts,0);
  assert.equal(summary.deployedVerified,0);
  assert.equal(summary.contractCount,6);
  assert.ok(data.contracts.every(x=>x.status==="planned"&&x.contractId===null));
});
test("M4 registry refuses public network, fabricated deployment flags and invalid asset issuers",async()=>{
  const data=await load();
  assert.throws(()=>validateRegistry({...data,network:"mainnet"}),/canonical/);
  assert.throws(()=>validateRegistry({...data,contracts:data.contracts.map((x,i)=>i===0?{...x,status:"deployed"}:x)}),/status/);
  assert.throws(()=>validateRegistry({...data,assets:[...data.assets,{key:"USDC",kind:"issued",issuer:"fake",status:"candidate",contractId:null}]}),/issuer/);
  assert.throws(()=>validateRegistry({...data,contracts:[data.contracts[0],...data.contracts]}),/roles/);
});
test("M4 refuses bogus Stellar contract identifiers",()=>{
  assert.equal(isStellarContractId("C"+"A".repeat(55)),false);
  assert.equal(isStellarContractId("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),false);
  assert.equal(isStellarContractId(null),false);
});
