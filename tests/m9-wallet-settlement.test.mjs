import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  validateSettlementTerms,toContractTerms,requireCandidateSpotRegistry,
  m9OnchainPreflight,m9TwoWalletSettlement,checkM9Receipt,M9_SEND_ACK,assertTxShape
} from "../matching/m9-wallet-settlement.mjs";
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function strKey(version,bytes32){
  const bytes=[version,...bytes32];let crc=0;
  for(const b of bytes){crc^=b<<8;for(let i=0;i<8;i++)crc=(crc&0x8000)?(((crc<<1)^0x1021)&65535):((crc<<1)&65535);}
  bytes.push(crc&255,crc>>8);
  let bits=0,acc=0,out="";
  for(const b of bytes){acc=(acc<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=ALPHABET[(acc>>>bits)&31];acc&=(1<<bits)-1;}}
  if(bits)out+=ALPHABET[(acc<<(5-bits))&31];
  return out;
}
const G1=strKey(48,Array(32).fill(1)),G2=strKey(48,Array(32).fill(2));
const C1=strKey(16,Array(32).fill(3)),C2=strKey(16,Array(32).fill(4)),C3=strKey(16,Array(32).fill(5));
const HASH="a".repeat(64);
function terms(){
  return {
    match_id:"1".repeat(64),maker_order_id:"2".repeat(64),taker_order_id:"3".repeat(64),
    maker:G1,taker:G2,base_token:C2,quote_token:C3,
    base_amount:"10000000",quote_amount:"20000000",
    maker_side:0,maker_limit_e7:"19000000",taker_limit_e7:"21000000",
    expires_at_ledger:5000040
  };
}
async function registry(){
  const r=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  const spot=r.contracts.find(x=>x.role==="spot-settlement");
  spot.status="candidate";spot.contractId=C1;spot.deploymentTxHash=HASH;spot.verifiedAtLedger=4999900;
  return r;
}
function mockServer({network="Test SDF Network ; September 2015",ledger=5000000,paused=false,settled=false,
  allow=true,decimals=7,amount="90000000",isReadCall=true}={}){
  const history=[];
  let wasSent=false;
  const server={
    history,
    getNetwork:async()=>({passphrase:network}),
    getLatestLedger:async()=>({sequence:ledger}),
    getContractMethods:async()=>["settle","receipt","is_settled","paused","allowed"].map(name=>({name})),
    queryContract:async(id,method,args)=>{
      history.push({id,method,args});
      const result=method==="paused"?paused:
        method==="is_settled"?(wasSent||settled):
        method==="allowed"?allow:
        method==="decimals"?decimals:
        method==="balance"?amount:
        method==="receipt"?wasSent?{
          match_id:Uint8Array.from(Buffer.from("1".repeat(64),"hex")),
          maker_order_id:Uint8Array.from(Buffer.from("2".repeat(64),"hex")),
          taker_order_id:Uint8Array.from(Buffer.from("3".repeat(64),"hex")),
          maker:G1,taker:G2,base_token:C2,quote_token:C3,
          base_amount:10000000n,quote_amount:20000000n,
          maker_side:0,settled_ledger:5000005
        }:null:null;
      return {isReadCall,result};
    },
    setSent:()=>{wasSent=true;}
  };
  return server;
}
function fakeSdk(server,{extra=[G2],fee="22000",ops=1,finalStatus="SUCCESS",wrongTx=false}={}){
  const events=[];
  const source={publicKey:()=>G1},other={publicKey:()=>G2};
  let signedAuth=false;
  const tx={
    isReadCall:false,
    built:{fee,operations:Array.from({length:ops},()=>({type:wrongTx?"payment":"invokeHostFunction"}))},
    needsNonInvokerSigningBy:()=>signedAuth?[]:[...extra],
    signAuthEntries:async({address,signAuthEntry})=>{
      events.push("signAuth");
      assert.equal(address,G2);
      assert.equal(typeof signAuthEntry,"function");
      signedAuth=true;
    },
    signAndSend:async()=>{
      events.push("signAndSend");
      server.setSent();
      return {
        sendTransactionResponse:{hash:HASH},
        getTransactionResponse:{hash:HASH,status:finalStatus}
      };
    }
  };
  const sdk={
    contract:{
      basicNodeSigner:(key,passphrase)=>{
        assert.equal(passphrase,"Test SDF Network ; September 2015");
        return {signTransaction:async()=>true,signAuthEntry:async()=>true};
      },
      Client:{
        from:async(options)=>{
          events.push("client");
          assert.equal(options.contractId,C1);
          assert.equal(options.publicKey,G1);
          assert.equal(options.networkPassphrase,"Test SDF Network ; September 2015");
          return {
            settle:async({terms:t},options)=>{
              events.push("simulate");
              assert.ok(t.match_id instanceof Uint8Array);
              assert.equal(t.base_amount,10000000n);
              assert.equal(t.quote_amount,20000000n);
              assert.equal(options.fee,"1000");
              return tx;
            }
          };
        }
      }
    }
  };
  return {sdk,source,other,events};
}
test("M9 wallet flow rejects missing, extra, duplicate, malformed and unbounded on-chain terms",()=>{
  const t=terms();
  assert.equal(validateSettlementTerms(t).maker,G1);
  assert.throws(()=>validateSettlementTerms({...t,extra:true}),/exactly/);
  assert.throws(()=>validateSettlementTerms({...t,match_id:"x".repeat(64)}),/32 bytes/);
  assert.throws(()=>validateSettlementTerms({...t,maker_order_id:t.taker_order_id}),/differ/);
  assert.throws(()=>validateSettlementTerms({...t,taker:t.maker}),/Distinct/);
  assert.throws(()=>validateSettlementTerms({...t,base_token:t.quote_token}),/Distinct/);
  assert.throws(()=>validateSettlementTerms({...t,base_amount:"1.5"}),/integer/);
  assert.throws(()=>validateSettlementTerms({...t,quote_amount:"10000000000000000"}),/bounds/);
  assert.throws(()=>validateSettlementTerms({...t,maker_side:3}),/maker_side/);
  assert.throws(()=>validateSettlementTerms({...t,expires_at_ledger:2**32}),/u32/);
  assert.throws(()=>validateSettlementTerms({...t,quote_amount:"10000000"}),/limit prices/);
});
test("M9 maps exact 7-decimal amounts and BytesN identifiers to the SDK",()=>{
  const t=toContractTerms(terms());
  assert.ok(t.match_id instanceof Uint8Array);
  assert.equal(t.match_id.length,32);
  assert.equal(t.base_amount,10000000n);
  assert.equal(t.maker_limit_e7,19000000n);
});
test("M9 requires actual candidate deployment evidence before any wallet signing",async()=>{
  const r=await registry();
  assert.equal(requireCandidateSpotRegistry(r,C1),true);
  assert.throws(()=>requireCandidateSpotRegistry(r,C2),/candidate/);
  r.contracts.find(x=>x.role==="spot-settlement").status="planned";
  r.contracts.find(x=>x.role==="spot-settlement").contractId=null;
  r.contracts.find(x=>x.role==="spot-settlement").deploymentTxHash=null;
  r.contracts.find(x=>x.role==="spot-settlement").verifiedAtLedger=null;
  assert.throws(()=>requireCandidateSpotRegistry(r,C1),/candidate/);
});
test("M9 preflight verifies Testnet, contract methods, approved tokens and payer balances",async()=>{
  const server=mockServer();
  const result=await m9OnchainPreflight({server,terms:terms(),contractId:C1,registry:await registry()});
  assert.equal(result.state,"PREFLIGHT_VERIFIED");
  assert.equal(result.executionPermitted,false);
  assert.deepEqual(server.history.filter(x=>x.method==="balance").map(x=>x.args.id),[G1,G2]);
});
test("M9 stale, wrong-network, paused, settled, unsupported decimals, insufficient funds fail closed",async()=>{
  const r=await registry();
  for(const [opts,pattern] of [
    [{network:"Public Global Stellar Network ; September 2015"},/passphrase/],
    [{ledger:5000041},/deadline/],
    [{ledger:4999800},/deadline/],
    [{paused:true},/paused/],
    [{settled:true},/already settled/],
    [{allow:false},/not approved/],
    [{decimals:6},/7 decimals/],
    [{amount:"1"},/insufficient/],
    [{isReadCall:false},/read-only/]
  ]){
    const srv=mockServer(opts);
    await assert.rejects(()=>m9OnchainPreflight({server:srv,terms:terms(),contractId:C1,registry:r}),pattern);
  }
});
test("M9 one-operation and bounded fee gate rejects unexpected transfers and high fees",()=>{
  assert.equal(assertTxShape({isReadCall:false,built:{fee:"2000",operations:[{type:"invokeHostFunction"}]}}),2000n);
  for(const tx of [
    {isReadCall:true,built:{fee:"2000",operations:[{type:"invokeHostFunction"}]}},
    {isReadCall:false,built:{fee:"2000",operations:[{type:"payment"}]}},
    {isReadCall:false,built:{fee:"2000",operations:[{type:"invokeHostFunction"},{type:"payment"}]}},
    {isReadCall:false,built:{fee:"9999999999",operations:[{type:"invokeHostFunction"}]}}
  ])assert.throws(()=>assertTxShape(tx),/expected|only one|fee ceiling/);
});
test("M9 defaults to simulation and does not sign or send either wallet",async()=>{
  const server=mockServer(),{sdk,source,other,events}=fakeSdk(server);
  const p=await m9TwoWalletSettlement({sdk,sourceKeypair:source,otherKeypair:other,server,terms:terms(),registry:await registry(),contractId:C1});
  assert.equal(p.status,"SIMULATED_ONLY");
  assert.equal(p.executionPermitted,false);
  assert.deepEqual(events,["client","simulate"]);
  assert.equal(server.history.some(x=>x.method==="receipt"),false);
});
test("M9 refuses submission without explicit send acknowledgement",async()=>{
  const server=mockServer(),{sdk,source,other,events}=fakeSdk(server);
  await assert.rejects(()=>m9TwoWalletSettlement({sdk,sourceKeypair:source,otherKeypair:other,server,terms:terms(),registry:await registry(),contractId:C1,send:true}),/Explicit/);
  assert.equal(events.includes("signAndSend"),false);
});
test("M9 dual-wallet signing uses taker auth first, maker envelope last, then confirms exact chain receipt",async()=>{
  const server=mockServer(),{sdk,source,other,events}=fakeSdk(server);
  const result=await m9TwoWalletSettlement({sdk,sourceKeypair:source,otherKeypair:other,server,terms:terms(),registry:await registry(),contractId:C1,send:true,sendAcknowledgement:M9_SEND_ACK});
  assert.equal(result.state,"CONFIRMED_ONCHAIN");
  assert.equal(result.transactionHash,HASH);
  assert.equal(result.marginIntegrated,false);
  assert.deepEqual(events,["client","simulate","signAuth","signAndSend"]);
  assert.equal(server.history.some(x=>x.method==="receipt"),true);
});
test("M9 signing rejects wrong taker, unexpected auth signer and an unconfirmed result",async()=>{
  const r=await registry();
  {
    const server=mockServer(),{sdk,source,other,events}=fakeSdk(server,{extra:[G1]});
    await assert.rejects(()=>m9TwoWalletSettlement({sdk,sourceKeypair:source,otherKeypair:other,server,terms:terms(),registry:r,contractId:C1,send:true,sendAcknowledgement:M9_SEND_ACK}),/EXACTLY the taker/);
    assert.equal(events.includes("signAndSend"),false);
  }
  {
    const server=mockServer(),{sdk,source,other}=fakeSdk(server,{finalStatus:"FAILED"});
    await assert.rejects(()=>m9TwoWalletSettlement({sdk,sourceKeypair:source,otherKeypair:other,server,terms:terms(),registry:r,contractId:C1,send:true,sendAcknowledgement:M9_SEND_ACK}),/final success/);
  }
  {
    const server=mockServer(),{sdk,source,other}=fakeSdk(server);
    await assert.rejects(()=>m9TwoWalletSettlement({sdk,sourceKeypair:other,otherKeypair:source,server,terms:terms(),registry:r,contractId:C1}),/maker must be/);
  }
});
test("M9 chain receipt must exactly match match ID, both order IDs, wallets, assets and quantities",()=>{
  const t=terms();
  const good={
    match_id:Uint8Array.from(Buffer.from(t.match_id,"hex")),
    maker_order_id:Uint8Array.from(Buffer.from(t.maker_order_id,"hex")),
    taker_order_id:Uint8Array.from(Buffer.from(t.taker_order_id,"hex")),
    maker:t.maker,taker:t.taker,base_token:t.base_token,quote_token:t.quote_token,
    base_amount:10000000n,quote_amount:20000000n,maker_side:0,settled_ledger:5000005
  };
  assert.equal(checkM9Receipt(good,t).verified,true);
  for(const altered of [
    {...good,quote_amount:10000000n},
    {...good,base_token:C3},
    {...good,match_id:Uint8Array.from(Buffer.alloc(32))},
    {...good,taker:G1},
    {...good,settled_ledger:0}
  ])assert.throws(()=>checkM9Receipt(altered,t),/receipt/);
});
