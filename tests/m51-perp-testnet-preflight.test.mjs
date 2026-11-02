import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {StrKey} from "@stellar/stellar-sdk";
import {prepareM51PerpTerms,preflightM51XlmPerp,TESTNET_USDC_SAC,
  TESTNET_PASSPHRASE} from "../matching/m51-perp-testnet-preflight.mjs";

const MAKER="GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB";
const TAKER="GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2";
const ROLES=["perp-clearinghouse","oracle-adapter","risk-engine","unified-margin"];
const IDS=ROLES.map((_,i)=>StrKey.encodeContract(Buffer.alloc(32,i+1)));
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
  // Deterministic valid StrKeys only in mock tests, not real deployments.
  return {network:"testnet",passphrase:TESTNET_PASSPHRASE,contracts:roles};
}
function fixtureRegistry(){return registry();}
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


function mockRpc({network=TESTNET_PASSPHRASE,paused=false,
  systemRisk=true,quoteTime=NOWSEC-5, available=100000000n,
  wrongWasm=false,wrongToken=false}={}){
  const calls=[];
  const server={
    calls,
    async getNetwork(){calls.push("getNetwork");return {passphrase:network};},
    async getLatestLedger(){calls.push("getLatestLedger");return {
      sequence:NOWLEDGER,closeTime:String(NOWSEC)};},
    async getContractInstance(){calls.push("getContractInstance");return {executable:"verified-test-only"};},
    async getContractWasmByContractId(){calls.push("getContractWasmByContractId");
      return wrongWasm?Uint8Array.from({length:45},(_,i)=>i):WASM;},
    async queryContract(id,method,args){
      calls.push(method);
      const values={
        market:{market_id:1,collateral_token:wrongToken?IDS[0]:TESTNET_USDC_SAC,
          paused,oracle_configured:true,risk_configured:true,entry_gate_configured:!paused,
          initial_margin_bps:1000,maintenance_margin_bps:500,fee_bps:10},
        solvent:true,
        market_exposure:{index_complete:true,token_book_backed:true,
          insurance_snapshot_covered:true,system_risk_approved:systemRisk},
        current:{mark_e7:MARK,index_e7:INDEX,last_update_sec:quoteTime},
        wallet:{available_e7:available,locked_e7:0n}
      };
      if(method==="wallet")assert.ok([MAKER,TAKER].includes(args.owner));
      if(!(method in values))throw Error("Unexpected read "+method);
      return {isReadCall:true,result:values[method]};
    }
  };
  return server;
}
test("M51 fully reviewed deployed fixture builds a one-time bilateral perpetual preview without signing",async()=>{
  const rpc=mockRpc();
  const result=await preflightM51XlmPerp({
    server:rpc,registry:fixtureRegistry(),
    maker:MAKER,taker:TAKER,action:"long",
    quantityXlm:"5.0000000",limitPriceUsd:"0.2500000",
    positionId:POSITION
  });
  assert.equal(result.market,"xlm-usdc-perp");
  assert.equal(result.long,MAKER);assert.equal(result.short,TAKER);
  assert.equal(result.sorobanSimulationRequired,true);
  assert.equal(result.riskAndOracleSourcesVerified,true);
  assert.equal(result.executionPermitted,false);
  assert.equal(result.broadcast,false);
  assert.equal(result.isolatedMarginEachE7,"1010000");
  assert.equal(rpc.calls.filter(x=>x==="getContractInstance").length,4);
  assert.ok(!rpc.calls.includes("open")&&!rpc.calls.includes("set_pause"));
});
test("M51 rejects wrong network, WASM substitution, paused oracle and underfunded isolated margin",async()=>{
  for(const [options,expected] of [
    [{network:"Public Global Stellar Network ; September 2015"},/wrong Stellar/],
    [{wrongWasm:true},/WASM differs/],
    [{paused:true},/risk\/collateral/],
    [{systemRisk:false},/risk\/collateral/],
    [{wrongToken:true},/risk\/collateral/],
    [{quoteTime:NOWSEC-180},/stale or future/],
    [{available:0n},/insufficient verified isolated/]
  ]){
    const server=mockRpc(options);
    await assert.rejects(preflightM51XlmPerp({
      server,registry:fixtureRegistry(),
      maker:MAKER,taker:TAKER,action:"long",quantityXlm:"5.0000000",
      limitPriceUsd:"0.2500000",positionId:POSITION
    }),expected);
    assert.ok(!server.calls.includes("open"),"never call mutating contract open");
  }
});
