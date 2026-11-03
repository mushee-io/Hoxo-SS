import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const script=readFileSync(new URL("../scripts/check-m55-live-spot-simulation.mjs",import.meta.url),"utf8");
const simulation=readFileSync(new URL("../app/m45-spot-simulation.mjs",import.meta.url),"utf8");
const verifier=readFileSync(new URL("../app/m44-stellar-xdr-verifier.mjs",import.meta.url),"utf8");

test("M65 expanded resource fee is confined to read-only CI simulation",()=>{
  assert.match(script,/maxFeeStroops:10_000_000n/);
  assert.match(script,/simulateM45BilateralSpot/);
  assert.doesNotMatch(script,/\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signAuthEntry\s*\(/);
  assert.match(script,/broadcast:false,settlementVerified:false/);
  assert.match(simulation,/maxFeeStroops=1000000n/);
  assert.match(verifier,/maxFeeStroops=1000000n/);
  assert.match(verifier,/BigInt\(maxFeeStroops\)>10000000n/);
  assert.match(verifier,/observed /);
  assert.match(verifier,/configured /);
  assert.match(verifier,/hard maximum 10000000 stroops/);
});

import {classifyM65SimulationFee} from "../app/m44-stellar-xdr-verifier.mjs";
test("M65 exact live observed fee is rejected without weakening the signing ceiling",()=>{
  assert.deepEqual(classifyM65SimulationFee(21941726n,10000000n),{
    allowed:false,reason:"fee_exceeds_ceiling",observedStroops:"21941726",configuredStroops:"10000000"
  });
  assert.equal(classifyM65SimulationFee(21941726n,1000000n).allowed,false);
  assert.equal(classifyM65SimulationFee(10000000n,10000000n).allowed,true);
  assert.equal(classifyM65SimulationFee(10000001n,10000000n).allowed,false);
  assert.equal(classifyM65SimulationFee(100n,10000001n).allowed,false);
  assert.equal(classifyM65SimulationFee("NaN",1000000n).allowed,false);
});

test("M79 offline fee classification rejects implicit coercion and unsafe integers",()=>{
  for(const invalid of [null,true,false,{},[],["100"]," 100","0100","1e3","1.5",1.5,Number.MAX_SAFE_INTEGER+1]){
    assert.equal(classifyM65SimulationFee(invalid,1000000n).allowed,false);
    assert.equal(classifyM65SimulationFee(100n,invalid).allowed,false);
  }
  assert.deepEqual(classifyM65SimulationFee("100",1000000n),{
    allowed:true,reason:"within_ceiling",observedStroops:"100",configuredStroops:"1000000"
  });
  assert.equal(classifyM65SimulationFee(10000001n,10000000n).allowed,false);
});
