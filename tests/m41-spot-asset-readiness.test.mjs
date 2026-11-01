import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Asset,Networks} from "@stellar/stellar-sdk";
import {
  M41_SPOT_CANDIDATE,checkM41SpotAssetReadiness
} from "../activation/m41-spot-asset-readiness.mjs";

const MOCK_WASM=Buffer.from([0,97,115,109,1,0,0,0,3,2,1,0,0,0,1,2]);
const p={...M41_SPOT_CANDIDATE,
  spotWasmSha256:createHash("sha256").update(MOCK_WASM).digest("hex")};
function account(id,{xlm="10.0000000",quote="0.0000000",trust=false,authorized=true}={}){
  return {account_id:id,balances:[
    {asset_type:"native",balance:xlm},
    ...(trust?[{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:p.quoteIssuer,
      balance:quote,is_authorized:authorized}]:[])
  ]};
}
function lab({
  owner=p.spotOwner,paused=true,baseAllowed=false,quoteAllowed=false,baseDecimals=7,
  quoteDecimals=7,accounts={
    [p.spotOwner]:account(p.spotOwner),
    [p.otherTrader]:account(p.otherTrader),
  },
  wasm=MOCK_WASM,passphrase=Networks.TESTNET
}={}){
  const query=async(contract,method,args)=>{
    if(contract===p.spotContractId&&method==="admin")return owner;
    if(contract===p.spotContractId&&method==="paused")return paused;
    if(contract===p.baseSac&&method==="decimals")return baseDecimals;
    if(contract===p.quoteSac&&method==="decimals")return quoteDecimals;
    if(contract===p.spotContractId&&method==="allowed"&&args.asset===p.baseSac)
      return baseAllowed;
    if(contract===p.spotContractId&&method==="allowed"&&args.asset===p.quoteSac)
      return quoteAllowed;
    throw Error("unexpected Testnet query "+method);
  };
  const server={
    getNetwork:async()=>({passphrase}),
    getContractInstance:async()=>({executable:{type:"wasm"}}),
    getContractWasmByContractId:async()=>wasm,
    queryContract:async(...args)=>({isReadCall:true,result:await query(...args)})
  };
  const fetchImpl=async(url)=>{
    const addr=url.split("/").at(-1);
    return {ok:Object.hasOwn(accounts,addr),json:async()=>accounts[addr]};
  };
  return {server,fetchImpl,candidate:p};
}
test("M41 derives both native XLM and issued USDC SACs from canonical SDK Testnet",()=>{
  assert.equal(Asset.native().contractId(Networks.TESTNET),p.baseSac);
  assert.equal(new Asset("USDC",p.quoteIssuer).contractId(Networks.TESTNET),p.quoteSac);
  assert.notEqual(p.baseSac,p.quoteSac);
});
test("M41 live read-only candidate with funded XLM but no USDC reports precise signer blockers",async()=>{
  const result=await checkM41SpotAssetReadiness(lab());
  assert.equal(result.state,"BLOCKED_FREIGHTER_ASSET_SETUP");
  assert.equal(result.wasmHashVerified,true);
  assert.equal(result.ownerVerified,true);
  assert.equal(result.wallets.length,2);
  assert.equal(result.wallets[0].usdcTrustlinePresent,false);
  assert.equal(result.wallets[1].usdcTrustlinePresent,false);
  assert.equal(result.wallets[1].usdcE7,"0");
  assert.ok(result.blockers.some(b=>b.includes("Wallet 1 must sign")));
  assert.ok(result.blockers.some(b=>b.includes("Wallet 2 must sign")));
  assert.ok(result.blockers.some(b=>b.includes("Wallet 2 needs valueless")));
  assert.ok(result.blockers.some(b=>b.includes("unpause")));
  for(const k of ["tradingEnabled","executePermitted","realSignedTradeVerified"])
    assert.equal(result[k],false);
  assert.equal(result.confirmedVolumeE7,"0");
  assert.equal(Object.isFrozen(result.wallets),true);
});
test("even with trustlines, real USDC funding, signed approvals and unpause, M41 never authorizes trading",async()=>{
  const accounts={
    [p.spotOwner]:account(p.spotOwner,{xlm:"9999.0000000",trust:true,quote:"1.0000000"}),
    [p.otherTrader]:account(p.otherTrader,{xlm:"9999.0000000",trust:true,quote:"100.0000000"})
  };
  const r=await checkM41SpotAssetReadiness(lab({
    accounts,paused:false,baseAllowed:true,quoteAllowed:true
  }));
  assert.deepEqual(r.blockers,[]);
  assert.equal(r.state,"ASSETS_PREPARED_PENDING_INDEPENDENT_SIGNED_SETTLEMENT");
  assert.equal(r.executePermitted,false);
  assert.equal(r.tradingEnabled,false);
  assert.equal(r.realSignedTradeVerified,false);
});
test("fail closed on mismatched owner, wrong network, altered WASM, wrong decimals, unsafe RPC responses",async()=>{
  const wrong=[{owner:p.otherTrader},{passphrase:"Public Global Stellar Network ; September 2015"},
    {wasm:Buffer.from("fakewasm")},{baseDecimals:6},{quoteDecimals:18}];
  for(const opts of wrong){
    await assert.rejects(()=>checkM41SpotAssetReadiness(lab(opts)),/M41/);
  }
  const noRealRead=lab();
  noRealRead.server.queryContract=async()=>({isReadCall:false,result:true});
  await assert.rejects(()=>checkM41SpotAssetReadiness(noRealRead),/M41/);
  const noInstance=lab();
  noInstance.server.getContractInstance=async()=>null;
  await assert.rejects(()=>checkM41SpotAssetReadiness(noInstance),/M41/);
});
test("rejects forged issued asset IDs even if account balance exists",async()=>{
  await assert.rejects(()=>checkM41SpotAssetReadiness({
    ...lab(),candidate:{...p,baseSac:p.quoteSac}
  }),/M41/);
  await assert.rejects(()=>checkM41SpotAssetReadiness({
    ...lab(),candidate:{...p,quoteIssuer:p.otherTrader}
  }),/M41/);
  await assert.rejects(()=>checkM41SpotAssetReadiness({
    ...lab(),candidate:{...p,networkPassphrase:"Public Global Stellar Network ; September 2015"}
  }),/M41/);
});
test("fails closed on untrusted Horizon wallet identity and malformed decimals",async()=>{
  const a=account(p.spotOwner);
  const wrong={
    [p.spotOwner]:{...a,account_id:p.otherTrader},
    [p.otherTrader]:account(p.otherTrader)
  };
  await assert.rejects(()=>checkM41SpotAssetReadiness(lab({accounts:wrong})),/M41/);
  const malformed={
    [p.spotOwner]:account(p.spotOwner,{xlm:"1e20"}),
    [p.otherTrader]:account(p.otherTrader)
  };
  await assert.rejects(()=>checkM41SpotAssetReadiness(lab({accounts:malformed})),/M41/);
});
test("insufficient XLM, unauthorized USDC trustline and zero quote inventory block execution",async()=>{
  const a={
    [p.spotOwner]:account(p.spotOwner,{xlm:"0.1000000",trust:true,authorized:false}),
    [p.otherTrader]:account(p.otherTrader,{xlm:"0.2000000",trust:true,authorized:true})
  };
  const r=await checkM41SpotAssetReadiness(lab({accounts:a}));
  assert.ok(r.blockers.some(x=>x.includes("not authorized")));
  assert.ok(r.blockers.some(x=>x.includes("needs a safe native")));
  assert.ok(r.blockers.some(x=>x.includes("transaction-fee reserve")));
  assert.ok(r.blockers.some(x=>x.includes("needs valueless Testnet USDC")));
});
