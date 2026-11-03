import test from "node:test";
import assert from "node:assert/strict";
import {simulateM45BilateralSpot} from "../app/m45-spot-simulation.mjs";

test("M76 rejects invalid fee policy before contacting Testnet RPC", async()=>{
  let calls=0;
  const server={
    getLatestLedger(){calls++;throw Error("RPC should not be contacted");},
    getAccount(){calls++;throw Error("RPC should not be contacted");},
    simulateTransaction(){calls++;throw Error("RPC should not be contacted");}
  };
  for(const maxFeeStroops of [0n,99n,10000001n,-1n,"NaN",null,1.5,true,false,{},["100"]," 100","0100","1e3",Number.MAX_SAFE_INTEGER+1]){
    await assert.rejects(
      simulateM45BilateralSpot({server,preflight:null,maxFeeStroops}),
      /invalid simulation fee ceiling/
    );
  }
  assert.equal(calls,0);
});

test("M76 valid fee policy still requires verified Testnet preflight",async()=>{
  await assert.rejects(
    simulateM45BilateralSpot({server:null,preflight:null,maxFeeStroops:10000000n}),
    /fresh unpaused M9 Testnet proof required/
  );
});
