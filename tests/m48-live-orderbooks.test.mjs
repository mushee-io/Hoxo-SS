import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {normalizeM48KrakenDepth,normalizeM48HorizonBook,m48HorizonBookUrl,
  M48_CIRCLE_TEST_ISSUER} from "../app/m48-book-data.mjs";
import {readM48OrderBook} from "../api/market-orderbook.js";

const kraken={error:[],result:{XXLMZUSD:{
  asks:[["0.1687","13.4",1793600000],["0.1685","2.0",1793600000]],
  bids:[["0.1670","20",1793600000],["0.1680","5",1793600000]]
}}};
const stellar={base:{asset_type:"native"},
  counter:{asset_type:"credit_alphanum4",asset_code:"USDC",
    asset_issuer:M48_CIRCLE_TEST_ISSUER},
  bids:[{price:"0.167",amount:"100.0000000",price_r:{n:167,d:1000}}],
  asks:[{price:"0.169",amount:"80.0000000",price_r:{n:169,d:1000}}]
};

test("M48 real Kraken XLM/USD depth sorts bids/asks, calculates observed spread and forbids market substitution",()=>{
  const out=normalizeM48KrakenDepth(kraken);
  assert.equal(out.source,"Kraken");
  assert.equal(out.currency,"USD");
  assert.deepEqual(out.bids.map(x=>x.price),[0.168,0.167]);
  assert.deepEqual(out.asks.map(x=>x.price),[0.1685,0.1687]);
  assert.ok(out.spread>0&&out.spread<0.001);
  assert.equal(out.executable,false);
  assert.equal(out.hoxoFills,false);
  assert.throws(()=>normalizeM48KrakenDepth({error:[],result:{BTCUSD:kraken.result.XXLMZUSD}}),/wrong external market/);
  assert.throws(()=>normalizeM48KrakenDepth({error:[],result:{...kraken.result,ETHUSD:{}}}),/wrong external market/);
  assert.throws(()=>normalizeM48KrakenDepth({error:["rate limit"],result:{}}),/invalid Kraken/);
  assert.throws(()=>normalizeM48KrakenDepth({error:[],result:{
    XXLMZUSD:{asks:[["0.16","-12",1793600000]],bids:[]}
  }}),/invalid asks size/);
});

test("M48 Horizon book requires exact Testnet Circle USDC issuer and native XLM",()=>{
  const out=normalizeM48HorizonBook(stellar);
  assert.equal(out.currency,"USDC");
  assert.match(out.market,/classic DEX/);
  assert.equal(out.asks[0].price,0.169);
  assert.equal(out.bids[0].amount,100);
  assert.equal(out.executable,false);
  assert.equal(normalizeM48HorizonBook({...stellar,bids:[],asks:[]}).spread,null);
  assert.throws(()=>normalizeM48HorizonBook({...stellar,counter:{...stellar.counter,asset_issuer:"G"+"A".repeat(55)}}),/wrong Testnet asset identity/);
  assert.throws(()=>normalizeM48HorizonBook({...stellar,base:{asset_type:"credit_alphanum4"}}),/wrong Testnet asset identity/);
  const u=new URL(m48HorizonBookUrl());
  assert.equal(u.host,"horizon-testnet.stellar.org");
  assert.equal(u.searchParams.get("selling_asset_type"),"native");
  assert.equal(u.searchParams.get("buying_asset_code"),"USDC");
  assert.equal(u.searchParams.get("buying_asset_issuer"),M48_CIRCLE_TEST_ISSUER);
});

test("M48 read-only API sources are allowlisted and never report executable Hoxo orderbooks",async()=>{
  let called=0;
  const fetchImpl=async(url,opts)=>{
    called++;
    assert.equal(opts.method,"GET");
    assert.equal(opts.headers.accept,"application/json");
    return {ok:true,json:async()=>url.includes("kraken")?kraken:stellar};
  };
  const ref=await readM48OrderBook({source:"kraken",fetchImpl,nowMs:10000});
  assert.equal(ref.sourceKind,"kraken");
  assert.equal(ref.orderCount,4);
  assert.equal(ref.tradeExecutable,false);
  assert.equal(ref.hoxoSettlementEnabled,false);
  const stellarBook=await readM48OrderBook({source:"stellar-testnet",fetchImpl});
  assert.equal(stellarBook.orderCount,2);
  assert.equal(stellarBook.sourceKind,"stellar-testnet");
  assert.equal(called,2);
  await assert.rejects(readM48OrderBook({source:"mainnet",fetchImpl}),/Unsupported orderbook source/);
  await assert.rejects(readM48OrderBook({source:"kraken",fetchImpl:async()=>({ok:false})}),/unavailable/);
});

test("M48 browser terminal warns about independent USD vs USDC book and leaves trade disabled",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const js=await readFile(new URL("../app/m48-orderbook-ui.mjs",import.meta.url),"utf8");
  const main=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  for(const id of ["m48BookFeed","m48BookSource","m48BookLevels","m48BookStatus",
    "m48BookSourceWarning","m48Spread"])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/M9 spot settlement contract is deployed but paused/);
  assert.match(html,/<summary>PRODUCT STATUS<\/summary>/);
  assert.match(js,/KRAKEN · XLM\/USD · USD REFERENCE/);
  assert.match(js,/STELLAR TESTNET DEX · XLM\/USDC · USDC/);
  assert.match(main,/hoxo:book-selection/);
  assert.match(html,/id="tradeButton"[^>]+disabled/);
  assert.doesNotMatch(js,/signTransaction|sendTransaction|set_pause\(false\)/);
});
