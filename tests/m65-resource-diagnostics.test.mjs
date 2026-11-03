import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectM66AssembledResources} from "../app/m45-spot-simulation.mjs";
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
