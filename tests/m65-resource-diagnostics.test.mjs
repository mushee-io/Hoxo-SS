import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectM66AssembledResources,inspectM69RpcDiagnosticShape,safeM84RpcCost} from "../app/m45-spot-simulation.mjs";
import {classifyM65SimulationFee} from "../app/m44-stellar-xdr-verifier.mjs";

const simulation=readFileSync(new URL("../app/m45-spot-simulation.mjs",import.meta.url),"utf8");

test("M65 live observed resource fees are rejected under both ceilings",()=>{
  for(const observed of [21941726n,21996999n]){
    assert.equal(classifyM65SimulationFee(observed,1000000n).allowed,false);
    assert.equal(classifyM65SimulationFee(observed,10000000n).allowed,false);
  }
});

test("M65 resource diagnostic stays on unsigned simulation path and refuses over-cap fees",()=>{
  assert.match(simulation,/assembledFee>BigInt\(maxFeeStroops\)/);
  assert.match(simulation,/minResourceFee/);
  assert.match(simulation,/cpuInsns/);
  assert.match(simulation,/memBytes/);
  assert.match(simulation,/no signing or broadcast/);
  assert.match(simulation,/reviewM44SourceEnvelope/);
  assert.doesNotMatch(simulation,/\.sendTransaction\s*\(|\.signTransaction\s*\(/);
});

test("M66 extracts exact counts from canonical envelope transaction-data XDR",()=>{
  const resources={
    instructions:()=>1234567,
    diskReadBytes:()=>456,
    writeBytes:()=>78,
    footprint:()=>({readOnly:()=>[1,2,3],readWrite:()=>[4]})
  };
  const assembled={toEnvelope:()=>({v1:()=>({tx:()=>({ext:()=>({
    sorobanData:()=>({resources:()=>resources,resourceFee:()=>22151779n})
  })})})})};
  assert.deepEqual(inspectM66AssembledResources(assembled),{
    instructions:"1234567",readBytes:"456",writeBytes:"78",
    readOnlyEntries:3,readWriteEntries:1,refundableFee:"22151779"
  });
});

test("M66 diagnostic fails closed to unknown without exposing transaction contents",()=>{
  assert.deepEqual(inspectM66AssembledResources({toEnvelope:()=>{throw Error("private auth XDR");}}),{
    instructions:"unknown",readBytes:"unknown",writeBytes:"unknown",
    readOnlyEntries:"unknown",readWriteEntries:"unknown",refundableFee:"unknown"
  });
});

test("M67 preserves available footprint and fee diagnostics when one SDK accessor is absent",()=>{
  const resources={
    instructions:()=>654321,readBytes:()=>2048,
    footprint:()=>({readOnly:()=>[1,2],readWrite:()=>[3]})
  };
  const assembled={toEnvelope:()=>({v1:()=>({tx:()=>({ext:()=>({
    sorobanData:()=>({resources:()=>resources,resourceFee:()=>22258090n})
  })})})})};
  assert.deepEqual(inspectM66AssembledResources(assembled),{
    instructions:"654321",readBytes:"2048",writeBytes:"unknown",
    readOnlyEntries:2,readWriteEntries:1,refundableFee:"22258090"
  });
});

test("M68 recovers resource diagnostics from RPC transactionData if envelope accessor fails",()=>{
  const data={resources:()=>({
    instructions:()=>98765,diskReadBytes:()=>1200,writeBytes:()=>900,
    footprint:()=>({readOnly:()=>[1],readWrite:()=>[2,3]})
  }),resourceFee:()=>22308918n};
  const assembled={toEnvelope:()=>{throw Error("unavailable envelope variant");}};
  assert.deepEqual(inspectM66AssembledResources(assembled,{transactionData:data}),{
    instructions:"98765",readBytes:"1200",writeBytes:"900",
    readOnlyEntries:1,readWriteEntries:2,refundableFee:"22308918"
  });
});

test("M69 shape diagnostics report only bounded public type labels, never transaction XDR",()=>{
  const privateXdr="secret-soroban-auth-material";
  const shape=inspectM69RpcDiagnosticShape({
    toEnvelope:()=>({switch:()=>({name:"envelopeTypeTx"}),v1:()=>({tx:()=>({ext:()=>({})})})})
  },{transactionData:privateXdr,minResourceFee:"22359602",cost:{auth:privateXdr}});
  assert.deepEqual(shape,{envelope:"envelopeTypeTx",extension:"present",
    transactionDataKind:"encoded-string",minResourceFeeKind:"decimal-string",costKind:"object",
    transactionDataMethods:[]});
  assert.doesNotMatch(JSON.stringify(shape),/secret-soroban-auth-material/);
  assert.equal(inspectM69RpcDiagnosticShape({toEnvelope:()=>{throw Error(privateXdr);}},{}).envelope,"unavailable");
});


test("M71 uses the SDK XDR envelope directly without requiring a nonexistent toXdr method",()=>{
  const data={resources:()=>({instructions:()=>777,diskReadBytes:()=>32,writeBytes:()=>64,
    footprint:()=>({readOnly:()=>[1],readWrite:()=>[2]})}),resourceFee:()=>22457677n};
  const assembled={toEnvelope:()=>({v1:()=>({tx:()=>({ext:()=>({sorobanData:()=>data})})})})};
  assert.deepEqual(inspectM66AssembledResources(assembled),{
    instructions:"777",readBytes:"32",writeBytes:"64",
    readOnlyEntries:1,readWriteEntries:1,refundableFee:"22457677"
  });
  assert.doesNotMatch(simulation,/assembled\.toXdr\(\)/);
});


test("M74 rejects malformed RPC fee strings from diagnostics without leaking content",()=>{
  const secret="private-auth-XDR";
  const shape=inspectM69RpcDiagnosticShape({toEnvelope:()=>{throw Error(secret);}},
    {transactionData:secret,minResourceFee:secret});
  assert.equal(shape.transactionDataKind,"encoded-string");
  assert.equal(shape.minResourceFeeKind,"encoded-string");
  assert.doesNotMatch(JSON.stringify(shape),/private-auth-XDR/);
  assert.equal(inspectM69RpcDiagnosticShape({toEnvelope:()=>{}},
    {minResourceFee:"22564708"}).minResourceFeeKind,"decimal-string");
});


test("M82 RPC diagnostic method allowlist cannot leak arbitrary SDK properties",()=>{
  const sensitive="private-auth-XDR-never-log";
  const data={toXDR:()=>sensitive,resources:()=>({secret:sensitive}),
    secret:sensitive,resourceFee:()=>1n};
  const shape=inspectM69RpcDiagnosticShape({toEnvelope:()=>{throw Error(sensitive);}},
    {transactionData:data,minResourceFee:"1234"});
  assert.deepEqual(shape.transactionDataMethods,["toXDR","resources","resourceFee"]);
  assert.equal(shape.transactionDataKind,"object");
  assert.equal(shape.minResourceFeeKind,"decimal-string");
  assert.doesNotMatch(JSON.stringify(shape),/private-auth-XDR-never-log/);
});


test("M83 unsigned simulation refuses RPC errors without exposing provider-controlled payloads",()=>{
  assert.match(simulation,/if\(!rpc\.Api\.isSimulationSuccess\(sim\)\)/);
  assert.match(simulation,/Review private operator RPC logs/);
  assert.doesNotMatch(simulation,/sim\.error\.slice\s*\(/);
  assert.doesNotMatch(simulation,/RPC: "\+detail/);
  assert.doesNotMatch(simulation,/\.sendTransaction\s*\(|\.signTransaction\s*\(/);
});


test("M84 cost diagnostics accept only bounded unsigned integer counters",()=>{
  for(const [input,expected] of [[0,"0"],[12345,"12345"],[12345n,"12345"],["12345","12345"],[18446744073709551615n,"18446744073709551615"],[18446744073709551616n,"unknown"],["18446744073709551616","unknown"],[-1,"unknown"],[1.5,"unknown"],[NaN,"unknown"],[Infinity,"unknown"],["-1","unknown"],["1e3","unknown"],["001","unknown"],[null,"unknown"],[true,"unknown"]]){
    assert.equal(safeM84RpcCost(input),expected);
  }
  const sensitive="private-auth-XDR-never-log";
  const hostile={toString(){throw Error(sensitive);}};
  assert.equal(safeM84RpcCost(hostile),"unknown");
  assert.equal(safeM84RpcCost(sensitive),"unknown");
  assert.match(simulation,/safeM84RpcCost\(sim\?\.cost\?\.cpuInsns\)/);
  assert.match(simulation,/safeM84RpcCost\(sim\?\.cost\?\.memBytes\)/);
  assert.doesNotMatch(simulation,/String\(sim\.cost\.cpuInsns\)/);
});

test("M85 Soroban resource counters never coerce hostile XDR accessors or leak auth",()=>{
  const secret="private-auth-XDR-never-log";
  const hostile={toString(){throw Error(secret);}};
  const resources={
    instructions:()=>hostile,
    diskReadBytes:()=>"-10",
    writeBytes:()=>18446744073709551616n,
    footprint:()=>({readOnly:()=>[1],readWrite:()=>[2]})
  };
  const data={resources:()=>resources,resourceFee:()=>hostile};
  const assembled={toEnvelope:()=>({v1:()=>({tx:()=>({ext:()=>({sorobanData:()=>data})})})})};
  const result=inspectM66AssembledResources(assembled);
  assert.deepEqual(result,{
    instructions:"unknown",readBytes:"unknown",writeBytes:"unknown",
    readOnlyEntries:1,readWriteEntries:1,refundableFee:"unknown"
  });
  assert.doesNotMatch(JSON.stringify(result),/private-auth-XDR-never-log/);
});


test("M86 envelope labels reject hostile coercion and arbitrary diagnostic text",()=>{
  const secret="private-auth-XDR-never-log";
  for(const label of [{toString(){throw Error(secret);}},secret,"envelopeTypeTx\\n"+secret]){
    const shape=inspectM69RpcDiagnosticShape({toEnvelope:()=>({switch:()=>({name:label}),v1:()=>({tx:()=>({ext:()=>({})})})})},{});
    assert.equal(shape.envelope,"unknown");
    assert.doesNotMatch(JSON.stringify(shape),/private-auth-XDR-never-log/);
  }
  assert.equal(inspectM69RpcDiagnosticShape({toEnvelope:()=>({switch:()=>({name:"envelopeTypeTx"})})},{}).envelope,"envelopeTypeTx");
});

test("M87 RPC diagnostics tolerate hostile getters and proxy method traps without leaking",()=>{
  const secret="private-auth-XDR-never-log";
  const hostileData=new Proxy({},{
    get(_target,key){if(key==="resources")throw Error(secret);if(key==="toXDR")throw Error(secret);return undefined;}
  });
  const hostileSim=new Proxy({},{
    get(_target,key){if(key==="transactionData")return hostileData;if(key==="minResourceFee"||key==="cost")throw Error(secret);return undefined;}
  });
  const shape=inspectM69RpcDiagnosticShape({toEnvelope:()=>{throw Error(secret);}},hostileSim);
  assert.deepEqual(shape,{
    envelope:"unavailable",extension:"unavailable",transactionDataKind:"object",
    minResourceFeeKind:"unavailable",costKind:"unavailable",transactionDataMethods:[]
  });
  assert.doesNotMatch(JSON.stringify(shape),/private-auth-XDR-never-log/);
  const inaccessible=new Proxy({}, {get(){throw Error(secret);}});
  assert.equal(inspectM69RpcDiagnosticShape({},inaccessible).transactionDataKind,"unavailable");
});
