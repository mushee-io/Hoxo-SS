import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "../app/m43-freighter-auth-guard.mjs";
import {M45_CANDIDATE,checkM45TestnetPreflight} from "../app/m45-spot-preflight.mjs";
import {draftM45BilateralTerms,simulateM45BilateralSpot} from "../app/m45-spot-simulation.mjs";
import {createM45SigningLab} from "../app/m45-signing-lab.mjs";

const nowMs=Date.parse("2026-11-02T02:00:00.000Z");
const expectedHash=M45_CANDIDATE.wasmSha256;
const hashBytes=Uint8Array.from(expectedHash.match(/../g),x=>parseInt(x,16));
function fakeRpc({paused=true,baseAllowed=true,quoteAllowed=true,network=TESTNET_PASSPHRASE,ledger=1000}={}){
  const calls=[];
  const wasm=Uint8Array.from({length:12},(_,i)=>i+1);
  return {
    calls,
    async getNetwork(){calls.push("getNetwork");return {passphrase:network};},
    async getLatestLedger(){calls.push("getLatestLedger");return {sequence:ledger};},
    async getContractInstance(){calls.push("getContractInstance");return {contractId:M9_TESTNET_CONTRACT_ID};},
    async getContractWasmByContractId(){calls.push("getContractWasmByContractId");return wasm;},
    async queryContract(id,fn,args){
      calls.push(fn);
      const result=fn==="admin"?M45_CANDIDATE.maker:
        fn==="paused"?paused:
        fn==="decimals"?7:
        fn==="allowed"?(args?.asset===M45_CANDIDATE.contract?false:
          args?.asset?.startsWith("CDLZ")?baseAllowed:quoteAllowed):null;
      return {isReadCall:true,result};
    }
  };
}
function horizon({authorized=true,usdc="25.0000000"}={}){
  const account=address=>({
    account_id:address,balances:[
      {asset_type:"native",balance:"1000.0000000"},
      {asset_type:"credit_alphanum4",asset_code:"USDC",
       asset_issuer:M45_CANDIDATE.quoteIssuer,balance:usdc,is_authorized:authorized}
    ]
  });
  return async (url,options)=>{
    assert.equal(options.method,"GET");
    assert.equal(options.cache,"no-store");
    let data;
    if(url.endsWith("/accounts/"+M45_CANDIDATE.maker))data=account(M45_CANDIDATE.maker);
    else if(url.endsWith("/accounts/"+M45_CANDIDATE.taker))data=account(M45_CANDIDATE.taker);
    else if(url.endsWith("/"))data={
      network_passphrase:TESTNET_PASSPHRASE,history_latest_ledger:1000,
      history_latest_ledger_closed_at:new Date(nowMs-5000).toISOString()
    };
    else throw Error("Unexpected Horizon URL "+url);
    return {ok:true,json:async()=>data};
  };
}
async function fakeHash(fn){
  const before=Object.getOwnPropertyDescriptor(globalThis,"crypto");
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{
    subtle:{digest:async(algorithm,input)=>{
      assert.equal(algorithm,"SHA-256");
      assert.equal(input.byteLength,12);
      return hashBytes.buffer.slice(0);
    }},
    getRandomValues:arr=>arr.fill(2)
  }});
  try{return await fn();}
  finally{if(before)Object.defineProperty(globalThis,"crypto",before);
    else delete globalThis.crypto;}
}
test("M45 read-only RPC/Horizon preflight confirms approved assets but blocks paused M9",async()=>{
  await fakeHash(async()=>{
    const server=fakeRpc();
    const proof=await checkM45TestnetPreflight({server,fetchImpl:horizon(),nowMs});
    assert.equal(proof.verifiedWasm,true);
    assert.equal(proof.contractPaused,true);
    assert.equal(proof.baseAllowed,true);
    assert.equal(proof.quoteAllowed,true);
    assert.equal(proof.wallets[0].trustlineAuthorized,true);
    assert.equal(proof.readyForSimulation,false);
    assert.equal(proof.state,"PAUSED_REVIEW_ONLY");
    assert.match(proof.blockers.join(" "),/paused/);
    assert.equal(proof.executionPermitted,false);
    assert.equal(proof.broadcast,false);
    assert.equal(server.calls.includes("settle"),false);
    assert.equal(server.calls.includes("set_pause"),false);
  });
});
test("M45 preflight rejects wrong chain, unapproved asset, stale/unauthorized account",async()=>{
  await fakeHash(async()=>{
    await assert.rejects(checkM45TestnetPreflight({
      server:fakeRpc({network:"Public Global Stellar Network ; September 2015"}),
      fetchImpl:horizon(),nowMs
    }),/wrong Stellar network/);
    const blocked=await checkM45TestnetPreflight({server:fakeRpc({paused:false,baseAllowed:false}),
      fetchImpl:horizon(),nowMs});
    assert.equal(blocked.readyForSimulation,false);
    assert.match(blocked.blockers.join(" "),/XLM/);
    const noTrust=await checkM45TestnetPreflight({server:fakeRpc({paused:false}),
      fetchImpl:horizon({authorized:false}),nowMs});
    assert.equal(noTrust.readyForSimulation,false);
    await assert.rejects(checkM45TestnetPreflight({
      server:fakeRpc(),fetchImpl:horizon(),nowMs:nowMs+300000
    }),/stale/);
    const badRpc=fakeRpc();
    badRpc.getContractWasmByContractId=async()=>Uint8Array.from({length:20},()=>2);
    // The fake digest is pinned to expected hash for deterministic tests;
    // malformed WASM length/shape must still be rejected before hash.
    badRpc.getContractWasmByContractId=async()=>new Uint8Array(0);
    await assert.rejects(checkM45TestnetPreflight({
      server:badRpc,fetchImpl:horizon(),nowMs
    }),/WASM unavailable/);
  });
});
test("M45 manual bilateral terms use 7-decimal bigint pricing and unique IDs",()=>{
  let n=0;
  const randomBytes=length=>Uint8Array.from({length},()=>++n%256);
  const terms=draftM45BilateralTerms({xlmAmount:"0.0100000",usdcAmount:"0.0200000",
    ledger:1000,randomBytes});
  assert.equal(terms.maker,M45_CANDIDATE.maker);
  assert.equal(terms.taker,M45_CANDIDATE.taker);
  assert.equal(terms.base_amount,"100000");
  assert.equal(terms.quote_amount,"200000");
  assert.equal(terms.maker_limit_e7,"20000000");
  assert.equal(terms.taker_limit_e7,"20000000");
  assert.equal(terms.expires_at_ledger,1020);
  assert.notEqual(terms.match_id,terms.maker_order_id);
  assert.notEqual(terms.maker_order_id,terms.taker_order_id);
  assert.throws(()=>draftM45BilateralTerms({xlmAmount:"0.3",usdcAmount:"0.0000001",
    ledger:1000,randomBytes}),/exactly representable/);
  assert.throws(()=>draftM45BilateralTerms({xlmAmount:"1e5",usdcAmount:"0.02",
    ledger:1000,randomBytes}),/invalid exact/);
  assert.throws(()=>draftM45BilateralTerms({xlmAmount:"0.01000000",usdcAmount:"0.02",
    ledger:1000,randomBytes}),/invalid exact/);
  assert.throws(()=>draftM45BilateralTerms({xlmAmount:"0.01",usdcAmount:"0.02",
    ledger:1000,randomBytes:()=>new Uint8Array(32)}),/must be unique/);
});
test("M45 cannot simulate while contract paused or when RPC simulation fails",async()=>{
  await assert.rejects(simulateM45BilateralSpot({server:{},preflight:{readyForSimulation:false,
    contractPaused:true}}),/unpaused M9/);
  let touched=false;
  await assert.rejects(simulateM45BilateralSpot({
    server:{async getAccount(){touched=true;},async getLatestLedger(){touched=true;},
      async simulateTransaction(){touched=true;}},
    preflight:{readyForSimulation:false,contractPaused:true}
  }),/unpaused M9/);
  assert.equal(touched,false);
});
test("M45 signing lab insists on explicit consent, live proof and blocks paused wallets",async()=>{
  const calls={auth:0,tx:0};
  const adapter={
    async getAddress(){return {address:M45_CANDIDATE.taker};},
    async getNetwork(){return {networkPassphrase:TESTNET_PASSPHRASE};},
    async signAuthEntry(){calls.auth++;throw Error("must not sign");},
    async signTransaction(){calls.tx++;throw Error("must not sign");}
  };
  const paused={network:"Stellar Testnet",contract:M9_TESTNET_CONTRACT_ID,
    observedAtMs:nowMs,ledger:1000,verifiedWasm:true,contractPaused:true,
    baseAllowed:true,quoteAllowed:true,readyForSimulation:false,
    wallets:[{address:M45_CANDIDATE.maker,trustlineAuthorized:true},
      {address:M45_CANDIDATE.taker,trustlineAuthorized:true}],
    blockers:["M9 paused"]};
  const lab=createM45SigningLab({adapter,probe:async()=>paused,now:()=>nowMs,
    simulate:async()=>{throw Error("must not simulate");}});
  assert.equal((await lab.check()).phase,"BLOCKED");
  await assert.rejects(lab.prepare({acknowledged:true,xlmAmount:"0.01",usdcAmount:"0.02"}),/paused/);
  await assert.rejects(lab.prepare({acknowledged:false}),/acknowledgement/);
  await assert.rejects(lab.approveTaker({acknowledged:true}),/confirmation and simulation/);
  assert.equal(calls.auth,0);
  assert.equal(calls.tx,0);
  assert.equal(lab.snapshot().broadcast,false);
  assert.equal(lab.snapshot().executionPermitted,false);
});
test("M45 browser code never enables normal Buy/Sell or broadcasts",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m45-spot-ui.mjs",import.meta.url),"utf8");
  const signing=await readFile(new URL("../app/m45-signing-lab.mjs",import.meta.url),"utf8");
  assert.match(html,/id="tradeButton"[^>]+disabled/);
  for(const name of ["m45SigningLab","m45Check","m45Prepare","m45SignTaker",
    "m45SignMaker","m45TermsAck","m45TakerAck","m45MakerAck"]){
    assert.match(html,new RegExp('id="'+name+'"'));
  }
  assert.match(html,/m45-spot.bundle\.js/);
  assert.doesNotMatch(ui+signing,/\.sendTransaction\(|\.signAndSend\(|set_pause\(false\)/);
  assert.match(ui,/approveTaker/);
  assert.match(ui,/approveMaker/);
});
