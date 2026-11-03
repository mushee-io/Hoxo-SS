import test from "node:test";
import assert from "node:assert/strict";
import {simulateM45BilateralSpot} from "../app/m45-spot-simulation.mjs";

test("M77 canonical decimal-string fee policy reaches preflight, not a false fee rejection", async()=>{
  let rpcCalls=0;
  const server={getLatestLedger(){rpcCalls++;throw Error("RPC should not be called");}};
  for(const ceiling of ["100","1000000","10000000"]){
    await assert.rejects(
      simulateM45BilateralSpot({server,preflight:null,maxFeeStroops:ceiling}),
      /fresh unpaused M9 Testnet proof required/
    );
  }
  assert.equal(rpcCalls,0);
});

test("M77 rejects coerced and noncanonical fee policies before RPC",async()=>{
  let rpcCalls=0;
  const server={getLatestLedger(){rpcCalls++;throw Error("RPC should not be called");}};
  for(const ceiling of ["0100","1e3","100.0","-100"," 100","100 ","10000001","99","",null,true,false,{},[],1.5,Number.MAX_SAFE_INTEGER+1]){
    await assert.rejects(
      simulateM45BilateralSpot({server,preflight:null,maxFeeStroops:ceiling}),
      /invalid simulation fee ceiling/
    );
  }
  assert.equal(rpcCalls,0);
});
