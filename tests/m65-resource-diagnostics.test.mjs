import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
