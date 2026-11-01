import test from "node:test";
import assert from "node:assert/strict";
import {createDualWalletHandoff,validateDualWalletHandoff,TESTNET_PASSPHRASE} from "../app/m43-freighter-auth-guard.mjs";
const maker="G"+"A".repeat(55),taker="G"+"B".repeat(55);
const input={networkPassphrase:TESTNET_PASSPHRASE,contractId:"C"+"A".repeat(55),maker,taker,makerAuthXdr:"QUJDREVGR0hJSktM",takerAuthXdr:"QUJDREVGR0hJSktN",matchId:"a".repeat(64)};
test("fail closed on mainnet, same-wallet, injected accessors and secret fields",()=>{
 assert.throws(()=>validateDualWalletHandoff({...input,networkPassphrase:"Public Global Stellar Network ; September 2015"}),/Testnet/);
 assert.throws(()=>validateDualWalletHandoff({...input,taker:maker}),/distinct/);
 assert.throws(()=>validateDualWalletHandoff({...input,secret:"SSECRET"}),/unexpected/);
 let invoked=false;const bad={...input};Object.defineProperty(bad,"maker",{enumerable:true,get(){invoked=true;return maker}});
 assert.throws(()=>validateDualWalletHandoff(bad),/accessors/);assert.equal(invoked,false);
});
test("requires sequential, explicit distinct-wallet Freighter approvals and never broadcasts",async()=>{
 let current=maker,calls=0;
 const adapter={async getNetwork(){return {networkPassphrase:TESTNET_PASSPHRASE}},async getAddress(){return {address:current}},async signAuthEntry(xdr){calls++;return {signedAuthEntry:xdr+"signed"}}};
 const flow=createDualWalletHandoff(input,adapter);
 await assert.rejects(flow.approve("taker"),/out of order/);
 const first=await flow.approve("maker");assert.equal(first.broadcast,false);assert.equal(first.verified,false);
 await assert.rejects(flow.approve("maker"),/out of order/);
 await assert.rejects(flow.approve("taker"),/switch Freighter/);
 current=taker;const second=await flow.approve("taker");assert.equal(second.publicAddress,taker);
 assert.equal(calls,2);assert.equal(flow.status.approvalCount,2);assert.equal(flow.status.broadcast,false);
 await assert.rejects(flow.approve("taker"),/out of order/);
});
test("rejects wallet network switch and refused signature",async()=>{
 const adapter={async getNetwork(){return {networkPassphrase:"mainnet"}},async getAddress(){return {address:maker}},async signAuthEntry(){throw Error("denied")}};
 const flow=createDualWalletHandoff(input,adapter);
 await assert.rejects(flow.approve("maker"),/Testnet/);assert.equal(flow.status.approvalCount,0);
 adapter.getNetwork=async()=>({networkPassphrase:TESTNET_PASSPHRASE});
 await assert.rejects(flow.approve("maker"),/denied/);assert.equal(flow.status.approvalCount,0);
});

test("blocks concurrent approvals while a Freighter prompt is outstanding",async()=>{
 let release;
 const wait=new Promise(resolve=>{release=resolve});
 let calls=0;
 const adapter={async getNetwork(){return {networkPassphrase:TESTNET_PASSPHRASE}},async getAddress(){return {address:maker}},async signAuthEntry(xdr){calls++;await wait;return {signedAuthEntry:xdr+"signed"}}};
 const flow=createDualWalletHandoff(input,adapter);
 const first=flow.approve("maker");
 await assert.rejects(flow.approve("maker"),/in progress/);
 release();
 await first;
 assert.equal(calls,1);
 assert.equal(flow.status.approvalCount,1);
});
test("rejects wallet and network changes during signature approval without advancing",async()=>{
 let address=maker,passphrase=TESTNET_PASSPHRASE;
 const adapter={async getNetwork(){return {networkPassphrase:passphrase}},async getAddress(){return {address}},async signAuthEntry(){address=taker;return {signedAuthEntry:"signed"}}};
 const flow=createDualWalletHandoff(input,adapter);
 await assert.rejects(flow.approve("maker"),/changed during approval/);
 assert.equal(flow.status.approvalCount,0);
 assert.equal(flow.nextRole,"maker");
 address=maker;
 adapter.signAuthEntry=async()=>{passphrase="Public Global Stellar Network ; September 2015";return {signedAuthEntry:"signed"}};
 await assert.rejects(flow.approve("maker"),/changed during approval/);
 assert.equal(flow.status.approvalCount,0);
 passphrase=TESTNET_PASSPHRASE;
 adapter.signAuthEntry=async()=>({signedAuthEntry:"signed"});
 await flow.approve("maker");
 assert.equal(flow.status.approvalCount,1);
});
