import test from "node:test";
import assert from "node:assert/strict";
import {inspectM66AssembledResources} from "../app/m45-spot-simulation.mjs";

// Reproduces the SDK-version mismatch observed in exact-head M71 CI:
// toEnvelope() returns a plain object without a v1() union accessor.
// The public-only simulation metadata must still be inspected safely.
test("M72: plain-object envelope uses bounded RPC resource fallback",()=>{
  const assembled={
    toXdr:()=>"invalid-test-xdr",
    toEnvelope:()=>({tx:{ext:{}}})
  };
  const sim={transactionData:{
    resources:()=>({
      instructions:()=>123456,
      diskReadBytes:()=>4096,
      writeBytes:()=>2048,
      footprint:()=>({readOnly:()=>[1,2],readWrite:()=>[3]})
    }),
    resourceFee:()=>22512949
  }};
  assert.deepEqual(inspectM66AssembledResources(assembled,sim),{
    instructions:"123456",readBytes:"4096",writeBytes:"2048",
    readOnlyEntries:2,readWriteEntries:1,refundableFee:"22512949"
  });
});

test("M72: missing or malformed resource metadata fails to unknown, not zero",()=>{
  const assembled={toXdr:()=>"",toEnvelope:()=>({})};
  const result=inspectM66AssembledResources(assembled,{transactionData:{}});
  assert.deepEqual(result,{
    instructions:"unknown",readBytes:"unknown",writeBytes:"unknown",
    readOnlyEntries:"unknown",readWriteEntries:"unknown",refundableFee:"unknown"
  });
});

// Diagnostics must identify SDK shape without leaking transaction bytes or
// Soroban authorization entries into CI output.
test("M73: diagnostic shape reveals method names only, never XDR",async()=>{
  const {inspectM69RpcDiagnosticShape}=await import("../app/m45-spot-simulation.mjs");
  const secret="SENSITIVE_XDR_MUST_NOT_APPEAR";
  const shape=inspectM69RpcDiagnosticShape({toEnvelope:()=>({})},{
    transactionData:{toXDR:()=>secret,resources:()=>({}),auth:secret},
    minResourceFee:"22564708"
  });
  assert.deepEqual(shape.transactionDataMethods,["toXDR","resources"]);
  assert.equal(shape.transactionDataKind,"object");
  assert.equal(JSON.stringify(shape).includes(secret),false);
});
