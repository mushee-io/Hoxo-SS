import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {prepareM51PerpTerms,preflightM51XlmPerp,TESTNET_USDC_SAC,
  TESTNET_PASSPHRASE} from "../matching/m51-perp-testnet-preflight.mjs";

const MAKER="GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB";
const TAKER="GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2";
const ROLES=["perp-clearinghouse","oracle-adapter","risk-engine","unified-margin"];
const IDS=["CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF"];
// These arbitrary ID fixtures never become real Hoxo deployment evidence.
const WASM=Uint8Array.from({length:45},(_,i)=>i+1);
const HASH=createHash("sha256").update(WASM).digest("hex");
const TX="a".repeat(64);
const NOWSEC=1793613600;
const NOWLEDGER=5500000;
const POSITION="a".repeat(64);
const MARK=2_000_000n,INDEX=2_000_000n;

function registry(){
  const roles=ROLES.map((role,i)=>({
    role,contractId:IDS[i],status:"verified",verifiedAtLedger:NOWLEDGER-200,
    wasmSha256:HASH,deploymentTxHash:TX
  }));
  // Test-only distinct, well-shaped contract StrKeys; no production claims.
  roles[3].contractId="CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF";
  return {network:"testnet",passphrase:TESTNET_PASSPHRASE,contracts:roles};
}
function fixtureRegistry(){
  // Registry function checks actual StrKey checksums; known deployed SACs
  // and M9 are only used in fixtures. Real Hoxo perp deploys do NOT exist.
  const r=registry();
  // Distinct 4th fixture from another valid known Stellar Testnet contract is
  // not available in repo, so the baseline registry should fail closed.
  return r;
}
function params(overrides={}){
  return {maker:MAKER,taker:TAKER,action:"long",quantityXlm:"5.0000000",
    limitPriceUsd:"0.2500000",markPriceUsd:"0.2000000",
    ledger:NOWLEDGER,positionId:POSITION,...overrides};
}
test("M51 long/short XLM bilateral terms map maker correctly without borrowing mainnet quotes",()=>{
  const long=prepareM51PerpTerms(params());
  const short=prepareM51PerpTerms(params({action:"short",limitPriceUsd:"0.1500000"}));
  assert.equal(long.long,MAKER);assert.equal(long.short,TAKER);
  assert.equal(short.long,TAKER);assert.equal(short.short,MAKER);
  assert.equal(long.quantityE7,"50000000");
  assert.equal(long.longMaxE7,"2500000");
  assert.equal(long.shortMinE7,"2000000");
  assert.equal(short.shortMinE7,"1500000");
  assert.equal(short.longMaxE7,"2000000");
  assert.equal(long.expiresAtLedger,NOWLEDGER+15);
  assert.equal(short.executionPermitted,undefined);
  assert.equal(short.submissionPermitted,false);
  assert.throws(()=>prepareM51PerpTerms(params({maker:TAKER,taker:TAKER})),/distinct/);
  assert.throws(()=>prepareM51PerpTerms(params({action:"perp-market"})),/long or short/);
  assert.throws(()=>prepareM51PerpTerms(params({limitPriceUsd:"0.1000000"})),/long limit/);
  assert.throws(()=>prepareM51PerpTerms(params({action:"short",limitPriceUsd:"0.3000000"})),/short limit/);
  assert.throws(()=>prepareM51PerpTerms(params({quantityXlm:"1e8"})),/invalid/);
  assert.throws(()=>prepareM51PerpTerms(params({positionId:"bad"})),/32-byte/);
});
test("M51 refuses real planned/unverified Hoxo perps before making any on-chain write",async()=>{
  const actual=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  let calls=0;
  const server={async getNetwork(){calls++;return {passphrase:TESTNET_PASSPHRASE}}};
  await assert.rejects(preflightM51XlmPerp({registry:actual,server,...params()}),/independently verified on-chain deployment/);
  assert.equal(calls,0);
});
test("M51 rejects missing, invalid and aliased perp/oracle/risk/unified-margin deployments",async()=>{
  const server={async getNetwork(){throw Error("RPC must not be touched");}};
  for(const r of [
    fixtureRegistry(),
    {...fixtureRegistry(),passphrase:"Public Global Stellar Network ; September 2015"},
    {...fixtureRegistry(),contracts:fixtureRegistry().contracts.filter(x=>x.role!=="oracle-adapter")},
    {...fixtureRegistry(),contracts:fixtureRegistry().contracts.map(x=>({...x,wasmSha256:null}))}
  ])await assert.rejects(preflightM51XlmPerp({registry:r,server,...params()}));
});
test("M51 gate never signs, simulates a mutable tx or calls a send/unpause method",async()=>{
  const src=await readFile(new URL("../matching/m51-perp-testnet-preflight.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signAuthEntry\s*\(|\.signAndSend\s*\(/);
  assert.doesNotMatch(src,/set_pause\s*\(|\.open\s*\(|\.deposit\s*\(/);
  assert.match(src,/system_risk_approved/);
  assert.match(src,/getContractWasmByContractId/);
  assert.match(src,/market_exposure/);
  assert.match(src,/exact canonical Testnet registry/);
});
