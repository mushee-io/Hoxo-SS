import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {quoteDirectXlmUsdc,formatE7,parseE7,readUsdcBalance,
  assertCapacity,verifyQuoteFresh,USDC_TESTNET_ISSUER} from "../app/m63-spot-core.mjs";
const level=(amount,n,d)=>({amount,price_r:{n,d}});
const book={
  base:{asset_type:"native"},
  counter:{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:USDC_TESTNET_ISSUER},
  bids:[level("1000.0000000",108,1000)],asks:[level("1000.0000000",248,1000)]
};
const nowMs=1793648000000;
test("M63 real Testnet Classic DEX BUY 10 XLM calculates exact max USDC with 1% protection",()=>{
  const q=quoteDirectXlmUsdc({side:"buy",quantityXlm:"10",book,nowMs});
  assert.equal(q.quantityXlm,"10.0000000");
  assert.equal(q.expectedUsdc,"2.4800000");
  assert.equal(q.limitUsdc,"2.5048000");
  assert.equal(q.route,"DIRECT_ONLY");
  assert.equal(q.venue,"Stellar Classic DEX");
  assert.equal(q.submitted,false);
  assert.equal(verifyQuoteFresh(q,{side:"buy",quantityXlm:"10",nowMs:nowMs+29999}),true);
  assert.throws(()=>verifyQuoteFresh(q,{side:"buy",quantityXlm:"10",nowMs:nowMs+30001}),/quote expired/);
  assert.throws(()=>verifyQuoteFresh(q,{side:"sell",quantityXlm:"10",nowMs}),/quote expired/);
  assert.throws(()=>verifyQuoteFresh(q,{side:"buy",quantityXlm:"11",nowMs}),/quote expired/);
});
test("M63 SELL 10 XLM and crossing multi-level book cannot invent volume",()=>{
  const q=quoteDirectXlmUsdc({side:"sell",quantityXlm:"10",book,nowMs});
  assert.equal(q.expectedUsdc,"1.0800000");
  assert.equal(q.limitUsdc,"1.0692000");
  const split={...book,asks:[level("5.0000000",248,1000),
    level("10.0000000",25,100)]};
  const buy=quoteDirectXlmUsdc({side:"buy",quantityXlm:"10",book:split,nowMs});
  assert.equal(buy.expectedUsdc,"2.4900000");
  assert.equal(buy.levels,2);
  assert.throws(()=>quoteDirectXlmUsdc({side:"buy",quantityXlm:"100",book:split,nowMs}),
    /not enough matching/);
});
test("M63 rejects wrong USDC issuer, malformed amounts, prices and zero depth",()=>{
  for(const amount of ["0","0.0000000","1e5","-1","0.00000001","01","Infinity"])
    assert.throws(()=>parseE7(amount),/valid|positive/);
  assert.equal(formatE7(parseE7("1000000.1234567")),"1000000.1234567");
  assert.throws(()=>quoteDirectXlmUsdc({side:"buy",quantityXlm:"1",book:{
    ...book,counter:{...book.counter,asset_issuer:"BAD"}
  },nowMs}),/different network asset pair/);
  assert.throws(()=>quoteDirectXlmUsdc({side:"sell",quantityXlm:"1",book:{
    ...book,bids:[level("50.0000000",0,2)]
  },nowMs}),/invalid authentic/);
  assert.throws(()=>quoteDirectXlmUsdc({side:"sell",quantityXlm:"1",book,nowMs,
    slippageBps:10000}),/slippage/);
});
test("M63 verifies real quote token balance/trustline and native reserve before signing",()=>{
  const make=(xlm,usd)=>({subentry_count:1,num_sponsoring:0,num_sponsored:0,
    balances:[{asset_type:"native",balance:xlm},{
      asset_type:"credit_alphanum4",asset_code:"USDC",
      asset_issuer:USDC_TESTNET_ISSUER,balance:usd,is_authorized:true
    }]});
  const account=make("100.0000000","4.0000000");
  const balance=readUsdcBalance(account);
  const buy=quoteDirectXlmUsdc({side:"buy",quantityXlm:"10",book,nowMs});
  assert.equal(assertCapacity({side:"buy",quote:buy,balance,account}),true);
  const sell=quoteDirectXlmUsdc({side:"sell",quantityXlm:"10",book,nowMs});
  assert.equal(assertCapacity({side:"sell",quote:sell,balance,account}),true);
  const poor=make("1.0000000","0.0000001");
  assert.throws(()=>assertCapacity({side:"buy",quote:buy,
    balance:readUsdcBalance(poor),account:poor}),/insufficient Testnet USDC/);
  assert.throws(()=>assertCapacity({side:"sell",quote:sell,
    balance:readUsdcBalance(poor),account:poor}),/insufficient spendable XLM/);
  assert.throws(()=>readUsdcBalance({balances:[{asset_type:"native",balance:"10.0000000"}]}),
    /trustline missing/);
});
test("M63 browser code only signs on explicit wallet approval, never bypasses independent Horizon confirmation",async()=>{
  const ui=await readFile(new URL("../app/m63-spot-ui.mjs",import.meta.url),"utf8");
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const bundle=await readFile(new URL("../scripts/build-m45.mjs",import.meta.url),"utf8");
  assert.match(html,/id="m63Approve"/);
  assert.match(html,/m63-spot\.bundle\.js/);
  assert.match(bundle,/app\/m63-spot\.bundle\.js/);
  assert.match(ui,/pathPaymentStrictReceive/);
  assert.match(ui,/pathPaymentStrictSend/);
  assert.match(ui,/api\.signTransaction\(tx\.toXDR\(\)/);
  assert.match(ui,/submit:false/);
  assert.match(ui,/signed\.hash\(\)\.toString\("hex"\)!==tx\.hash\(\)/);
  assert.match(ui,/server\.submitTransaction\(signed\)/);
  assert.match(ui,/receipt\.successful!==true/);
  assert.doesNotMatch(ui,/Keypair\.fromSecret|setTimeout\(.*submitTransaction|localStorage\.setItem/);
});
