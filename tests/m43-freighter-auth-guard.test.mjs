import test from "node:test";
import assert from "node:assert/strict";
import {createDualWalletHandoff,validateDualWalletHandoff,TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "../app/m43-freighter-auth-guard.mjs";

const maker="G"+"A".repeat(55), taker="G"+"B".repeat(55);
const SOURCE="QUJDREVGR0hJSktM", AUTH="QUJDREVGR0hJSktN";
const SIGNED_AUTH="RkZGRkZGRkZGRkZG", PREPARED="SEhISEhISEhISEhI", SIGNED_TX="QUJDREVGR0hJSktL";
const input={networkPassphrase:TESTNET_PASSPHRASE,contractId:M9_TESTNET_CONTRACT_ID,
  maker,taker,sourceTxXdr:SOURCE,takerAuthXdr:AUTH,matchId:"a".repeat(64)};

function fixture(){
  let selected=taker,passphrase=TESTNET_PASSPHRASE;
  const calls={auth:[],tx:[],prepare:[],send:0};
  const freighter={
    async getNetwork(){return {networkPassphrase:passphrase};},
    async getAddress(){return {address:selected};},
    async signAuthEntry(xdr,options){calls.auth.push({xdr,options});return {signedAuthEntry:SIGNED_AUTH,signerAddress:taker};},
    async signTransaction(xdr,options){calls.tx.push({xdr,options});return {signedTxXdr:SIGNED_TX,signerAddress:maker};},
    async sendTransaction(){calls.send++;throw Error("should never send");}
  };
  const prepareEnvelope=async request=>{calls.prepare.push(request);return {preparedTxXdr:PREPARED};};
  const flow=createDualWalletHandoff(input,freighter,prepareEnvelope);
  return {flow,freighter,calls,select:v=>{selected=v;},network:v=>{passphrase=v;}};
}

test("accepts only the exact Testnet M9 maker-source and taker-auth handoff shape",()=>{
  const t=validateDualWalletHandoff(input);
  assert.equal(t.sourceTxXdr,SOURCE);
  assert.equal(t.takerAuthXdr,AUTH);
  assert.deepEqual(Object.keys(t).sort(),Object.keys(input).sort());
  assert.throws(()=>validateDualWalletHandoff({...input,makerAuthXdr:AUTH}),/unexpected field/);
  assert.throws(()=>validateDualWalletHandoff({...input,networkPassphrase:"Public Global Stellar Network ; September 2015"}),/Testnet/);
  assert.throws(()=>validateDualWalletHandoff({...input,contractId:"C"+"A".repeat(55)}),/invalid contract/);
  assert.throws(()=>validateDualWalletHandoff({...input,maker:taker}),/distinct/);
  assert.throws(()=>validateDualWalletHandoff({...input,sourceTxXdr:AUTH}),/must differ/);
  assert.throws(()=>validateDualWalletHandoff({...input,matchId:"x".repeat(64)}),/canonical match ID/);
});

test("Taker signs Soroban authorization FIRST; maker/source signs prepared envelope SECOND; never broadcasts",async()=>{
  const f=fixture();
  await assert.rejects(f.flow.approve("maker"),/out of order/);
  const first=await f.flow.approve("taker");
  assert.equal(first.signatureType,"sorobanAuthEntry");
  assert.equal(first.publicAddress,taker);
  assert.equal(first.signedAuthEntry,SIGNED_AUTH);
  assert.equal(first.verified,false);
  assert.equal(first.broadcast,false);
  assert.equal(f.calls.tx.length,0);
  assert.equal(f.calls.auth.length,1);
  assert.deepEqual(f.calls.auth[0],{xdr:AUTH,options:{address:taker,networkPassphrase:TESTNET_PASSPHRASE}});
  assert.equal(f.flow.nextRole,"maker");
  assert.equal(f.flow.status.approvalCount,1);
  await assert.rejects(f.flow.approve("taker"),/out of order/);
  await assert.rejects(f.flow.approve("maker"),/switch Freighter/);
  f.select(maker);
  const second=await f.flow.approve("maker");
  assert.equal(second.signatureType,"transactionEnvelope");
  assert.equal(second.publicAddress,maker);
  assert.equal(second.signedTxXdr,SIGNED_TX);
  assert.equal(second.verified,false);
  assert.equal(second.broadcast,false);
  assert.equal(f.calls.prepare.length,1);
  assert.deepEqual(f.calls.prepare[0],{sourceTxXdr:SOURCE,signedTakerAuthEntry:SIGNED_AUTH,
    networkPassphrase:TESTNET_PASSPHRASE,contractId:M9_TESTNET_CONTRACT_ID,
    maker,taker,matchId:input.matchId});
  assert.deepEqual(f.calls.tx[0],{xdr:PREPARED,options:{address:maker,networkPassphrase:TESTNET_PASSPHRASE}});
  assert.equal(f.calls.auth.length,1); // maker is NEVER prompted for an extra Soroban auth entry
  assert.equal(f.calls.tx.length,1);
  assert.equal(f.calls.send,0);
  assert.deepEqual(f.flow.status,{nextRole:null,approvalCount:2,verified:false,broadcast:false});
  assert.equal(typeof f.flow.send,"undefined");
  await assert.rejects(f.flow.approve("maker"),/out of order/);
});

test("rejects wrong network, rejected signatures and permits explicit retry",async()=>{
  const f=fixture();
  f.network("mainnet");
  await assert.rejects(f.flow.approve("taker"),/Testnet/);
  assert.equal(f.calls.auth.length,0);
  f.network(TESTNET_PASSPHRASE);
  f.freighter.signAuthEntry=async()=>{throw Error("denied by Freighter");};
  await assert.rejects(f.flow.approve("taker"),/denied by Freighter/);
  assert.equal(f.flow.status.approvalCount,0);
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:SIGNED_AUTH});
  await f.flow.approve("taker");
  assert.equal(f.flow.status.approvalCount,1);
});

test("rejects wallet or network changes during taker signing",async()=>{
  const f=fixture();
  f.freighter.signAuthEntry=async()=>{f.select(maker);return {signedAuthEntry:SIGNED_AUTH};};
  await assert.rejects(f.flow.approve("taker"),/after signing/);
  assert.equal(f.flow.nextRole,"taker");
  f.select(taker);
  f.freighter.signAuthEntry=async()=>{f.network("mainnet");return {signedAuthEntry:SIGNED_AUTH};};
  await assert.rejects(f.flow.approve("taker"),/Testnet/);
  assert.equal(f.flow.status.approvalCount,0);
});

test("rejects concurrent prompts and leaves the flow retryable",async()=>{
  const f=fixture();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.freighter.signAuthEntry=async()=>{await gate;return {signedAuthEntry:SIGNED_AUTH};};
  const pending=f.flow.approve("taker");
  await assert.rejects(f.flow.approve("taker"),/in progress/);
  release();
  await pending;
  f.select(maker);
  let finish;
  const gate2=new Promise(resolve=>{finish=resolve;});
  f.freighter.signTransaction=async()=>{await gate2;return {signedTxXdr:SIGNED_TX};};
  const pendingMaker=f.flow.approve("maker");
  await assert.rejects(f.flow.approve("maker"),/in progress/);
  finish();
  await pendingMaker;
  assert.equal(f.flow.status.approvalCount,2);
});

test("fails closed on bad preparation and does not sign the source envelope",async()=>{
  const f=fixture();
  await f.flow.approve("taker");
  f.select(maker);
  let response={preparedTxXdr:SOURCE};
  const guard=createDualWalletHandoff(input,f.freighter,async()=>response);
  f.select(taker);await guard.approve("taker");f.select(maker);
  await assert.rejects(guard.approve("maker"),/valid auth-attached envelope/);
  assert.equal(guard.nextRole,"maker");
  assert.equal(f.calls.tx.length,0);
  response={preparedTxXdr:PREPARED,secret:"should-not-be-here"};
  await assert.rejects(guard.approve("maker"),/unexpected field/);
  let touched=false;response={};
  Object.defineProperty(response,"preparedTxXdr",{enumerable:true,get(){touched=true;return PREPARED;}});
  await assert.rejects(guard.approve("maker"),/accessors prohibited/);
  assert.equal(touched,false);
  assert.equal(guard.status.approvalCount,1);
  response={preparedTxXdr:PREPARED};
  await guard.approve("maker");
  assert.equal(guard.status.approvalCount,2);
});

test("requires source wallet after async envelope preparation and after its signature",async()=>{
  const f=fixture();
  await f.flow.approve("taker");f.select(maker);
  const bad=createDualWalletHandoff(input,f.freighter,async()=>{f.select(taker);return {preparedTxXdr:PREPARED};});
  f.select(taker);await bad.approve("taker");f.select(maker);
  await assert.rejects(bad.approve("maker"),/after envelope preparation/);
  assert.equal(bad.status.approvalCount,1);
  f.select(taker);
  const next=createDualWalletHandoff(input,f.freighter,async()=>({preparedTxXdr:PREPARED}));
  await next.approve("taker");f.select(maker);
  f.freighter.signTransaction=async()=>{f.network("mainnet");return {signedTxXdr:SIGNED_TX};};
  await assert.rejects(next.approve("maker"),/Testnet/);
  assert.equal(next.status.approvalCount,1);
});

test("rejects spoofed signer, malformed and unchanged signer responses",async()=>{
  const f=fixture();
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:SIGNED_AUTH,signerAddress:maker});
  await assert.rejects(f.flow.approve("taker"),/taker signer address mismatch/);
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:AUTH});
  await assert.rejects(f.flow.approve("taker"),/unchanged unsigned taker/);
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:"QUJDREVGR0hJSj=="}); // bad pad bits
  await assert.rejects(f.flow.approve("taker"),/invalid signed XDR/);
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:SIGNED_AUTH});
  await f.flow.approve("taker");f.select(maker);
  f.freighter.signTransaction=async()=>({signedTxXdr:PREPARED});
  await assert.rejects(f.flow.approve("maker"),/unchanged unsigned maker/);
  f.freighter.signTransaction=async()=>({signedTxXdr:SIGNED_TX,signerAddress:taker});
  await assert.rejects(f.flow.approve("maker"),/maker signer address mismatch/);
  f.freighter.signTransaction=async()=>({signedTxXdr:SIGNED_TX});
  await f.flow.approve("maker");
  assert.equal(f.flow.status.approvalCount,2);
  assert.equal(f.calls.send,0);
});

test("rejects hostile response fields/accessors and missing adapter methods",async()=>{
  assert.throws(()=>createDualWalletHandoff(input,{getNetwork(){},getAddress(){},signAuthEntry(){}},async()=>{}),/auth and envelope/);
  assert.throws(()=>createDualWalletHandoff(input,fixture().freighter),/envelope preparation/);
  const f=fixture();
  f.freighter.signAuthEntry=async()=>({signedAuthEntry:SIGNED_AUTH,seed:"secret"});
  await assert.rejects(f.flow.approve("taker"),/unexpected field/);
  let accessed=false;const evil={};
  Object.defineProperty(evil,"signedAuthEntry",{enumerable:true,get(){accessed=true;return SIGNED_AUTH;}});
  f.freighter.signAuthEntry=async()=>evil;
  await assert.rejects(f.flow.approve("taker"),/accessors prohibited/);
  assert.equal(accessed,false);
  const missing={...input};delete missing.matchId;
  const previous=Object.getOwnPropertyDescriptor(Object.prototype,"matchId");
  try{
    Object.defineProperty(Object.prototype,"matchId",{configurable:true,value:input.matchId});
    assert.throws(()=>validateDualWalletHandoff(missing),/missing own field: matchId/);
  }finally{
    if(previous)Object.defineProperty(Object.prototype,"matchId",previous);
    else delete Object.prototype.matchId;
  }
});

test("only canonical base64 is accepted for source, taker entry and outputs",async()=>{
  for(const bad of ["QUJDREVGR0hJSktM=","QUJDREVGR0hJSktM==","QUJDREVGR0hJSkt!","QUJDREVGR0hJSj=="]){
    assert.throws(()=>validateDualWalletHandoff({...input,sourceTxXdr:bad}),/invalid source/);
    assert.throws(()=>validateDualWalletHandoff({...input,takerAuthXdr:bad}),/invalid taker/);
  }
  const f=fixture();await f.flow.approve("taker");f.select(maker);
  f.freighter.signTransaction=async()=>({signedTxXdr:"QUJDREVGR0hJSj=="});
  await assert.rejects(f.flow.approve("maker"),/invalid signed XDR/);
  assert.equal(f.flow.status.approvalCount,1);
});
