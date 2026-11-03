import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parseKrakenReference,planTestnetMaker} from "../mm/testnet-classic-maker.mjs";
import {USDC_TESTNET_ISSUER} from "../app/m63-spot-core.mjs";

const nowMs=1793680000000;
const payload={
  error:[],
  result:{XXLMZUSD:{b:["0.179000000","10","10"],a:["0.181000000","10","10"]}}
};
const reference=parseKrakenReference(payload,{nowMs});
const book={
  base:{asset_type:"native"},
  counter:{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:USDC_TESTNET_ISSUER},
  bids:[{price_r:{n:14,d:100},amount:"100.0000000"}],
  asks:[{price_r:{n:22,d:100},amount:"100.0000000"}]
};
const account={
  subentry_count:1,num_sponsoring:0,num_sponsored:0,
  balances:[{asset_type:"native",balance:"100.0000000"},
    {asset_type:"credit_alphanum4",asset_code:"USDC",
      asset_issuer:USDC_TESTNET_ISSUER,balance:"20.0000000",is_authorized:true}]
};
const plan=(extra={})=>planTestnetMaker({account,book,reference,
  sizeXlm:"5",maxQuoteUsdc:"2",spreadBps:200,nowMs,...extra});
test("MM quotes are real inventory-funded, noncrossed Stellar Classic DEX bid and ask",()=>{
  assert.equal(reference.midE7,"1800000");
  const q=plan();
  assert.equal(q.quotes.length,2);
  assert.equal(q.quotes[0].side,"BID");
  assert.equal(q.quotes[1].side,"ASK");
  assert.equal(q.quotes[0].displayPriceUsdc,"0.1782000");
  assert.equal(q.quotes[1].displayPriceUsdc,"0.1818000");
  assert.equal(q.quotes[0].amount,"0.8910000");
  assert.equal(q.quotes[1].amount,"5.0000000");
  assert.deepEqual(q.quotes[0].price,{n:10000000,d:1782000});
  assert.deepEqual(q.quotes[1].price,{n:1818000,d:10000000});
  assert.equal(q.referenceSource,"KRAKEN_PUBLIC_XLMUSD_REFERENCE_ONLY");
  assert.equal(q.notHoxoM9,true);
  assert.equal(q.verifiedTradeCount,0);
  assert.equal(q.broadcast,false);
});
test("MM checks authentic Stellar account reserves and free USDC/XLM, including small wallets",()=>{
  const small={
    ...account,balances:[{asset_type:"native",balance:"5.0000000"},
      {asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:USDC_TESTNET_ISSUER,
        balance:"3.0000000",is_authorized:true}]
  };
  const q=plan({account:small});
  assert.equal(q.quotes[0].amount,"0.8910000");
  assert.equal(q.quotes[1].amount,"1.5000000");
  assert.throws(()=>plan({account:{
    ...small,balances:[{asset_type:"native",balance:"1.0000000"},
      small.balances[1]]
  }}),/insufficient free/);
  assert.throws(()=>plan({account:{...account,balances:account.balances.map(x=>
    x.asset_type==="native"?x:{...x,is_authorized:false})}}),/authorised Circle Testnet USDC/);
  assert.throws(()=>plan({account:{...account,
    balances:[account.balances[0]]}}),/trustline/);
});
test("MM refuses fake/malformed Kraken tickers, crossed or extraordinarily wide markets",()=>{
  for(const bad of [
    {error:["EAPI:Rate limit exceeded"],result:payload.result},
    {error:[],result:{}},
    {error:[],result:{XXLMZUSD:{b:["0.18"],a:["0.17"]}}},
    {error:[],result:{XXLMZUSD:{b:["0.18"],a:["0.25"]}}},
    {error:[],result:{XXLMZUSD:{b:["1e8"],a:["2"]}}}
  ])assert.throws(()=>parseKrakenReference(bad,{nowMs}),/Hoxo Testnet MM:/);
});
test("MM rejects stale, future, incorrect assets and price distortion",()=>{
  assert.throws(()=>plan({nowMs:nowMs+30001}),/no fresh independent/);
  assert.throws(()=>plan({nowMs:nowMs-1}),/no fresh independent/);
  assert.throws(()=>plan({spreadBps:0}),/spread must/);
  assert.throws(()=>plan({spreadBps:1001}),/spread must/);
  assert.throws(()=>plan({sizeXlm:"0"}),/positive/);
  assert.throws(()=>plan({maxQuoteUsdc:"10000"}),/controlled Testnet caps/);
  assert.throws(()=>plan({book:{...book,counter:{...book.counter,asset_issuer:"BAD"}}}),
    /wrong Testnet XLM\/USDC/);
  assert.throws(()=>plan({book:{...book,
    bids:[{price_r:{n:50,d:100},amount:"1"}]}}),/distorted/);
});
test("MM runner never signs on import and keeps secrets out of tracked configs",async()=>{
  const script=await readFile(new URL("../scripts/run-testnet-mm.mjs",import.meta.url),"utf8");
  const workflow=await readFile(new URL("../.github/workflows/spot-mm.yml",import.meta.url),"utf8");
  assert.match(script,/process\.env\.HOXO_MM_SECRET/);
  assert.match(script,/if\(botMode==="live"&&!armed\)/);
  assert.match(script,/process\.env\.HOXO_MM_LIVE==="YES"/);
  assert.match(script,/Networks\.TESTNET/);
  assert.match(script,/currentOffers/);
  assert.match(script,/cancellationOperations/);
  assert.match(script,/Operation\.manageSellOffer/);
  assert.match(script,/server\.submitTransaction/);
  assert.match(script,/tx\.sign\(signer\)/);
  assert.match(script,/check\.data\.successful!==true/);
  assert.match(workflow,/secrets\.HOXO_MM_SECRET/);
  assert.match(workflow,/vars\.HOXO_MM_LIVE/);
  assert.match(workflow,/cron: '.*\/5/);
  assert.doesNotMatch(workflow,/S[A-Z2-7]{55}/);
});
