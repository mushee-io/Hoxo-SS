import test from "node:test";
import assert from "node:assert/strict";
import {prepareTestnetMakerQuotePlan} from "../mm/quote-plan.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function key(version,byte){
  const data=[version,...Array(32).fill(byte)];
  let crc=0;
  for(const n of data){crc^=n<<8;for(let i=0;i<8;i++)
    crc=(crc&32768)?(((crc<<1)^0x1021)&65535):((crc<<1)&65535);}
  data.push(crc&255,crc>>8);
  let v=0,bits=0,out="";
  for(const n of data){
    v=(v<<8)|n;bits+=8;
    while(bits>=5){bits-=5;out+=alphabet[(v>>>bits)&31];v&=(1<<bits)-1;}
  }
  if(bits)out+=alphabet[(v<<(5-bits))&31];
  return out;
}
const maker=key(48,33);
const now=1_800_000_000_000;
const cfg={
  networkPassphrase:TESTNET_PASSPHRASE,
  makerPublicKey:maker,marketId:"xlm-usdc-spot",
  referencePrice:"10",observedAtMs:now-5000,nowMs:now,
  spreadBps:100,sizeBase:"1",
  freeBase:"10",freeQuote:"100",maxQuoteNotional:"15",
  inventoryReserveBps:2000
};
const plan=(overrides={})=>prepareTestnetMakerQuotePlan({...cfg,...overrides});
test("public maker G key and Testnet fixed-point spot quotes are valid but never fake volumes",()=>{
  assert.ok(isStellarGAddress(maker));
  const q=plan();
  assert.equal(q.marketType,"SPOT");
  assert.deepEqual(q.quotes,[
    {side:"buy",price:"9.95",sizeBase:"1",maxQuoteDebit:"9.95"},
    {side:"sell",price:"10.05",sizeBase:"1",maxBaseDebit:"1"}
  ]);
  assert.equal(q.networkPassphrase,TESTNET_PASSPHRASE);
  assert.equal(q.source,"CALLER_SUPPLIED_REFERENCE_PRICE_NOT_AUTHENTICATED");
  assert.equal(q.referenceVerifiedByChain,false);
  assert.equal(q.marketContractsVerified,false);
  for(const k of ["quotesSigned","quotesSubmitted","ordersPlaced","executionPermitted",
    "financialBetaApproved","selfMatchingPermitted","washTradingPermitted"])
    assert.equal(q[k],false,k);
  assert.equal(q.confirmedTrades,0);
  assert.equal(q.confirmedVolumeE7,"0");
  assert.equal(Object.isFrozen(q.quotes),true);
  assert.equal(Object.isFrozen(q.quotes[0]),true);
});
test("perpetual references can be risk-planned but cannot authorize or open a position",()=>{
  const q=plan({marketId:"xlm-usdc-perp"});
  assert.equal(q.marketType,"PERPETUAL");
  assert.match(q.blocker,/oracle/);
  assert.equal(q.executionPermitted,false);
  assert.equal(q.ordersPlaced,false);
});
test("wrong network, arbitrary pair and invalid public signer rejected",()=>{
  for(const input of [
    {networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {marketId:"xlm-usdc-mainnet"},
    {marketId:"FAKE-PAIR"},
    {makerPublicKey:"S"+"A".repeat(55)},
    {makerPublicKey:maker.slice(0,-1)+"Z"}
  ])assert.throws(()=>plan(input));
});
test("no stale, future, invalid or unauthenticated clock trust upgrade",()=>{
  for(const input of [
    {observedAtMs:now-30001},{observedAtMs:now+1},
    {nowMs:NaN},{nowMs:now+0.5},{observedAtMs:-1},
    {observedAtMs:"2026-11-01"},{nowMs:0}
  ])assert.throws(()=>plan(input),/M39 maker:/);
});
test("inventory cap protects simultaneous bid and ask without netting opposing quantities",()=>{
  for(const input of [
    {freeQuote:"10"},
    {freeBase:"1"},
    {maxQuoteNotional:"10"},
    {sizeBase:"0"},
    {freeBase:"0"},
    {freeQuote:"0"},
    {spreadBps:0},{spreadBps:1001},
    {inventoryReserveBps:0},{inventoryReserveBps:9500}
  ])assert.throws(()=>plan(input),/M39 maker:/);
});
test("spot price calculations use deterministic 7-decimal round-up and no crossed book",()=>{
  const q=plan({
    referencePrice:"0.000001",
    spreadBps:11,
    sizeBase:"1",
    maxQuoteNotional:"1"
  });
  assert.equal(q.quotes[0].price,"0.0000009");
  assert.equal(q.quotes[1].price,"0.0000011");
  assert.throws(()=>plan({referencePrice:"0.0000001"}),/M39 maker:/);
});
test("rejects malicious accessor, extra payload, symbol and missing field before use",()=>{
  const bad={...cfg};
  Object.defineProperty(bad,"referencePrice",{enumerable:true,get(){throw Error("side effect");}});
  assert.throws(()=>prepareTestnetMakerQuotePlan(bad),/accessor/);
  for(const x of [{...cfg,privateKey:"S_SECRET"}, {...cfg,tokenIssuer:"unreviewed"}]){
    assert.throws(()=>prepareTestnetMakerQuotePlan(x),/unexpected/);
  }
  const symbolic={...cfg,[Symbol("evil")]:42};
  assert.throws(()=>prepareTestnetMakerQuotePlan(symbolic),/unexpected/);
  const absent={...cfg};delete absent.maxQuoteNotional;
  assert.throws(()=>prepareTestnetMakerQuotePlan(absent),/missing/);
  assert.throws(()=>prepareTestnetMakerQuotePlan(Object.create(null)),/plain/);
});
test("unrealistic sizes, scientific notation, and fractional precision all rejected",()=>{
  for(const input of [
    {referencePrice:"1e8"},{referencePrice:"0"},
    {referencePrice:"1.12345678"},
    {sizeBase:"1000000000"}, {sizeBase:"-1"},
    {freeQuote:"Infinity"},{freeBase:"-2"},
    {maxQuoteNotional:"0"},{maxQuoteNotional:"1e10"}
  ])assert.throws(()=>plan(input),/M39 maker:/);
});
