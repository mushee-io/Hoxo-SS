import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {createM20Controls,createRequestLimiter,SecurityGateError} from "../security/controls.mjs";
import {createSandboxServer} from "../matching/http.mjs";
import {createIndexerApi} from "../indexer/api.mjs";
const NOW=1_800_000_000_000;
async function serverUrl(t,server){
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return "http://127.0.0.1:"+server.address().port;
}
test("M20 default-deny gates have no public operator permissions",()=>{
  const {gate,operator}=createM20Controls();
  assert.equal(gate.canObserve(),false);
  assert.equal(gate.status().executionPermitted,false);
  assert.equal(gate.status().operatorEndpoint,"NONE");
  assert.throws(()=>gate.assertSandboxCommand({type:"place"}),SecurityGateError);
  assert.throws(()=>gate.assertSandboxCommand({type:"sandbox_tick"}),/paused/);
  assert.equal(gate.assertSandboxCommand({type:"cancel"}),true);
  assert.throws(()=>operator.setPause("mainnet",false,"test operator"),/Invalid/);
  assert.throws(()=>operator.setPause("oracle",false,"short"),/Invalid/);
  assert.throws(()=>createM20Controls({sandboxPaused:"NO"}),/boolean/);
});
test("M20 isolation and oracle outage block price-dependent commands",()=>{
  const {gate,operator}=createM20Controls();
  operator.setPause("sandbox",false,"Reviewed sandbox-only operation");
  assert.throws(()=>gate.assertSandboxCommand({type:"advanced_place"}),/oracle circuit breaker/);
  assert.equal(gate.assertSandboxCommand({type:"advanced_cancel"}),true);
  operator.setPause("oracle",false,"Local sandbox tick operator review");
  assert.equal(gate.assertSandboxCommand({type:"place"}),true);
  assert.equal(gate.canObserve(),false);
  operator.setPause("indexer",false,"Read-only RPC candidate scan review");
  assert.equal(gate.canObserve(),true);
  operator.setPause("oracle",true,"Provider outage detected by operator");
  assert.throws(()=>gate.assertSandboxCommand({type:"sandbox_tick"}),/oracle circuit/);
  assert.equal(gate.status().executionPermitted,false);
});
test("M20 fixed-window limiter resists per-socket, global, key-flood and clock-rollback abuse",()=>{
  const limiter=createRequestLimiter({perKeyLimit:2,globalLimit:3,maxKeys:2,windowMs:1000});
  assert.equal(limiter.take("a",NOW).allowed,true);
  assert.equal(limiter.take("a",NOW+1).allowed,true);
  assert.equal(limiter.take("a",NOW+2).allowed,false);
  assert.equal(limiter.take("b",NOW+3).allowed,false);
  assert.equal(limiter.take("c",NOW+4).allowed,false);
  assert.equal(limiter.trackedClients,2);
  assert.equal(limiter.take("a",NOW-500).allowed,false);
  assert.equal(limiter.take("c",NOW+1500).allowed,true);
  assert.equal(limiter.trackedClients,1);
});
test("M20 sandbox API disallows paused signed commands but permits cancellation",async t=>{
  let calls=0;
  const journal={getStatus:()=>({status:"SANDBOX_READY",settlement:"DISABLED"}),
    submit:async command=>{calls++;return {type:command.type,executionPermitted:false};}};
  const controls=createM20Controls();
  const base=await serverUrl(t,createSandboxServer(journal,{security:controls.gate,now:()=>NOW}));
  const post=async(type,headers={})=>fetch(base+"/v1/commands",{
    method:"POST",headers:{"content-type":"application/json",
      "x-hoxo-sandbox-ack":"UNSETTLED",...headers},
    body:JSON.stringify({command:{type},signature:"sandbox-fixture"}),
  });
  let r=await post("place");assert.equal(r.status,503);assert.equal(calls,0);
  r=await post("cancel");assert.equal(r.status,201);assert.equal(calls,1);
  r=await post("place",{origin:"https://evil.example"});assert.equal(r.status,400);
  assert.equal(calls,1);
  controls.operator.setPause("sandbox",false,"Operator authorises sandbox testing");
  r=await post("place");assert.equal(r.status,503);assert.equal(calls,1);
  controls.operator.setPause("oracle",false,"Operator reviews local tick source");
  r=await post("place");assert.equal(r.status,201);assert.equal(calls,2);
  r=await fetch(base+"/health");assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.security.executionPermitted,false);
});
test("M20 indexer rejects remote administration and ignores forwarded IP spoofing",async t=>{
  const {gate}=createM20Controls();
  const base=await serverUrl(t,createIndexerApi({security:gate,now:()=>NOW,rateLimit:2}));
  let r=await fetch(base+"/v1/indexer/status",{headers:{"x-forwarded-for":"8.8.8.8"}});
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.security.indexerPaused,true);assert.equal(j.tradingEnabled,false);
  r=await fetch(base+"/v1/security/pause",{method:"POST"});assert.equal(r.status,405);
  r=await fetch(base+"/v1/indexer/status",{headers:{"x-forwarded-for":"1.1.1.1"}});
  assert.equal(r.status,429);assert.notEqual(r.headers.get("retry-after"),null);
});
