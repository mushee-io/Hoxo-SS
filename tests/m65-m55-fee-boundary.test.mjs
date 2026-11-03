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
});
