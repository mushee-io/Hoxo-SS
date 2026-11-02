import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createM46WindowsAcceptance} from "../app/m46-windows-acceptance.mjs";
import {M45_CANDIDATE} from "../app/m45-spot-preflight.mjs";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "../app/m43-freighter-auth-guard.mjs";

function harness(){
  let clock=1000000;
  let selected=M45_CANDIDATE.maker;
  let network=TESTNET_PASSPHRASE;
  let signed=0;
  const calls=[];
  const api={
    async getAddress(){calls.push("getAddress");return {address:selected};},
    async getNetwork(){calls.push("getNetwork");return {
      network:"TESTNET",networkPassphrase:network};},
    async signAuthEntry(){signed++;throw Error("NOT ALLOWED");},
    async signTransaction(){signed++;throw Error("NOT ALLOWED");},
    async requestAccess(){signed++;throw Error("NOT ALLOWED");}
  };
  let live={
    network:"Stellar Testnet",contract:M9_TESTNET_CONTRACT_ID,
    verifiedWasm:true,ledger:5500000,observedAtMs:clock,
    contractPaused:true,baseAllowed:true,quoteAllowed:true,
    wallets:[
      {address:M45_CANDIDATE.maker,trustlineAuthorized:true,xlmE7:"90000000000",usdcE7:"8100000000"},
      {address:M45_CANDIDATE.taker,trustlineAuthorized:true,xlmE7:"80000000000",usdcE7:"16000000000"}
    ],blockers:["M9 paused"],readyForSimulation:false,
    broadcast:false,executionPermitted:false
  };
  const probe=async()=>{calls.push("probe");return {...live,observedAtMs:clock};};
  const accept=createM46WindowsAcceptance({api,probe,now:()=>clock});
  return {accept,api,calls,select:x=>{selected=x;},changeNetwork:x=>{network=x;},
    changeProof:x=>{live={...live,...x};},clock:x=>{clock=x;},signCount:()=>signed};
}

test("M46 accepts both user-selected Windows Freighter accounts via live read-only Testnet proof",async()=>{
  const h=harness();
  const first=await h.accept.verify("wallet1");
  assert.equal(first.address,M45_CANDIDATE.maker);
  assert.equal(first.contractPaused,true);
  assert.equal(first.signatureRequested,false);
  assert.equal(first.broadcast,false);
  assert.equal(h.accept.summary().wallet1Verified,true);
  assert.equal(h.accept.summary().bothWalletsReviewed,false);
  h.select(M45_CANDIDATE.taker);
  const second=await h.accept.verify("wallet2");
  assert.equal(second.address,M45_CANDIDATE.taker);
  assert.equal(h.accept.summary().bothWalletsReviewed,true);
  assert.equal(h.accept.summary().contractActivationApproved,false);
  assert.equal(h.accept.summary().executionPermitted,false);
  assert.equal(h.accept.summary().broadcast,false);
  assert.equal(h.accept.summary().confirmedVolumeE7,"0");
  assert.equal(h.signCount(),0);
  assert.equal(h.calls.filter(x=>x==="probe").length,2);
  h.clock(1000000+120001);
  assert.equal(h.accept.summary().bothWalletsReviewed,false,"wallet reviews must expire");
});

test("M46 rejects wrong wallet, wrong network, and clears earlier acceptance evidence",async()=>{
  const h=harness();
  await h.accept.verify("wallet1");
  await assert.rejects(h.accept.verify("wallet2"),/exact expected Freighter account/);
  assert.equal(h.accept.summary().wallet1Verified,false);
  h.changeNetwork("Public Global Stellar Network ; September 2015");
  await assert.rejects(h.accept.verify("wallet1"),/Stellar Testnet/);
  assert.equal(h.calls.filter(x=>x==="probe").length,1);
  assert.equal(h.signCount(),0);
});

test("M46 refuses chain and contract substitution, missing trustline or unpaused M9",async()=>{
  const h=harness();
  h.changeProof({contractPaused:false});
  await assert.rejects(h.accept.verify("wallet1"),/M9 pause must remain/);
  h.changeProof({contractPaused:true,verifiedWasm:false});
  await assert.rejects(h.accept.verify("wallet1"),/fresh verified Testnet/);
  h.changeProof({verifiedWasm:true,baseAllowed:false});
  await assert.rejects(h.accept.verify("wallet1"),/assets not approved/);
  h.changeProof({baseAllowed:true,contract:"C"+"A".repeat(55)});
  await assert.rejects(h.accept.verify("wallet1"),/fresh verified Testnet/);
  h.changeProof({contract:M9_TESTNET_CONTRACT_ID,
    wallets:[{address:M45_CANDIDATE.maker,trustlineAuthorized:false,xlmE7:"90000000000",usdcE7:"8100000000"},
      {address:M45_CANDIDATE.taker,trustlineAuthorized:true,xlmE7:"80000000000",usdcE7:"16000000000"}]});
  await assert.rejects(h.accept.verify("wallet1"),/trustline not verified/);
  assert.equal(h.signCount(),0);
});

test("M46 re-checks selected wallet after awaiting public RPC and rejects mid-request account changes",async()=>{
  const h=harness();
  const original=h.api.getAddress;
  let n=0;
  h.api.getAddress=async()=>{
    n++;
    if(n===2)h.select(M45_CANDIDATE.taker);
    return original();
  };
  await assert.rejects(h.accept.verify("wallet1"),/exact expected Freighter account/);
  assert.equal(h.accept.summary().wallet1Verified,false);
  assert.equal(h.signCount(),0);
});

test("M46 blocks concurrent reviews and cannot reset during an in-flight RPC check",async()=>{
  let release;
  const pause=new Promise(resolve=>{release=resolve;});
  const h=harness();
  const initialApi=h.api.getAddress.bind(h.api);
  h.api.getAddress=async()=>{await pause;return initialApi();};
  const started=h.accept.verify("wallet1");
  await assert.rejects(h.accept.verify("wallet1"),/another wallet review/);
  assert.throws(()=>h.accept.reset(),/in-flight/);
  release();
  await started;
  assert.equal(h.accept.summary().wallet1Verified,true);
  assert.equal(h.accept.reset().wallet1Verified,false);
});

test("M46 Windows screen has two explicit read-only controls without sign/submit paths",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m46-windows-ui.mjs",import.meta.url),"utf8");
  const acceptance=await readFile(new URL("../app/m46-windows-acceptance.mjs",import.meta.url),"utf8");
  const terminal=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  for(const id of ["m46WindowsLab","m46WindowsAck","m46VerifyWallet1",
    "m46VerifyWallet2","m46Combined","m46Status","m46Reset"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(terminal,/m46WindowsLab/);
  assert.match(ui,/createM46WindowsAcceptance/);
  assert.doesNotMatch(ui+acceptance,/\.(?:signAuthEntry|signTransaction|sendTransaction|signAndSend|requestAccess)\s*\(/);
  assert.doesNotMatch(ui+acceptance,/set_pause\(false\)|submit:\s*true/);
  assert.match(html,/id="tradeButton"[^>]+class="trade-review"/);
});

test("M46 rejects wallet API errors, secret fields and accessor tricks without executing getters",async()=>{
  const h=harness();
  let getterHit=false;
  const malicious={};
  Object.defineProperty(malicious,"address",{enumerable:true,get(){getterHit=true;return M45_CANDIDATE.maker;}});
  h.api.getAddress=async()=>malicious;
  await assert.rejects(h.accept.verify("wallet1"),/unsafe accessor/);
  assert.equal(getterHit,false);
  h.api.getAddress=async()=>({address:M45_CANDIDATE.maker,secret:"SSECRET"});
  await assert.rejects(h.accept.verify("wallet1"),/unexpected field/);
  h.api.getAddress=async()=>({address:M45_CANDIDATE.maker,error:{message:"denied"}});
  await assert.rejects(h.accept.verify("wallet1"),/wallet error/);
  h.api.getAddress=async()=>({address:M45_CANDIDATE.maker});
  h.api.getNetwork=async()=>({network:"TESTNET",networkPassphrase:TESTNET_PASSPHRASE,seed:"SSECRET"});
  await assert.rejects(h.accept.verify("wallet1"),/unexpected field/);
  assert.equal(h.accept.summary().wallet1Verified,false);
  assert.equal(h.signCount(),0);
});


test("M46 rejects two individually valid wallet checks across incompatible ledgers",async()=>{
  const h=harness();
  await h.accept.verify("wallet1");
  h.select(M45_CANDIDATE.taker);
  h.changeProof({ledger:5500025});
  await assert.rejects(h.accept.verify("wallet2"),/incompatible Testnet ledger snapshots/);
  assert.equal(h.accept.summary().wallet1Verified,false);
  assert.equal(h.accept.summary().bothWalletsReviewed,false);
  h.select(M45_CANDIDATE.maker);
  h.changeProof({ledger:5500000});
  await h.accept.verify("wallet1");
  h.select(M45_CANDIDATE.taker);
  h.changeProof({ledger:5499998});
  await assert.rejects(h.accept.verify("wallet2"),/incompatible Testnet ledger snapshots/);
  assert.equal(h.signCount(),0);
});

test("M46 accepts sequential wallet proofs within the bounded ledger window",async()=>{
  const h=harness();
  await h.accept.verify("wallet1");
  h.select(M45_CANDIDATE.taker);
  h.changeProof({ledger:5500024});
  await h.accept.verify("wallet2");
  assert.equal(h.accept.summary().bothWalletsReviewed,true);
  assert.equal(h.signCount(),0);
});
