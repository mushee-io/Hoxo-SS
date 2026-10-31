import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TESTNET_CONFIG,TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {validateMarketRegistry,configuredPair,queryPair,PERIODS} from "../marketdata/model.mjs";
import {reviewOracle} from "../marketdata/oracle-guard.mjs";
import {loadPairMarketData,loadRecentNetworkTrades,normalizeCandles,normalizeOrderBook,parseNetworkTrade} from "../marketdata/horizon.mjs";
const ADDR="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const NOW=Date.parse("2026-10-31T09:00:00Z");
const root=()=>({network_passphrase:TESTNET_PASSPHRASE,history_latest_ledger:5000000,history_latest_ledger_closed_at:new Date(NOW-5000).toISOString()});
const native={asset_type:"native"},usdc={asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:ADDR};
const book=()=>({base:native,counter:usdc,bids:[{price:"0.1",amount:"2"}],asks:[{price:"0.2",amount:"3"}]});
const registry=async()=>JSON.parse(await readFile(new URL("../registry/market-data.testnet.json",import.meta.url),"utf8"));
const configured=async()=>{
 const data=await registry();
 data.markets[0].status="candidate";data.markets[0].quote={type:"credit_alphanum4",code:"USDC",issuer:ADDR};
 return data;
};
test("M5 registry has no priced, live, enabled or trusted asset market",async()=>{
 const data=await registry();const result=validateMarketRegistry(data);
 assert.equal(result.configured,0);assert.equal(result.unconfigured,5);
 assert.equal(result.oracleStatus,"HALTED: no verified on-chain oracle");
 assert.equal(data.oracle.positionPricingEnabled,false);
 assert.equal(configuredPair(data,"xlm-usdc-spot"),null);
});
test("M5 invalid issuer and mainnet data fail market registry",async()=>{
 const d=await configured();d.markets[0].quote.issuer="GINVALID";
 assert.throws(()=>validateMarketRegistry(d),/issuer/);
 const d2=await registry();d2.passphrase="Public Global Stellar Network ; September 2015";
 assert.throws(()=>validateMarketRegistry(d2),/not Stellar Testnet/);
 const d3=await registry();d3.oracle.halt=false;
 assert.throws(()=>validateMarketRegistry(d3),/safety lock/);
});
test("M5 candidate asset query uses Horizon base/counter identity",async()=>{
 const pair=configuredPair(await configured(),"xlm-usdc-spot");
 const params=queryPair(pair);
 assert.equal(params.get("base_asset_type"),"native");
 assert.equal(params.get("counter_asset_type"),"credit_alphanum4");
 assert.equal(params.get("counter_asset_issuer"),ADDR);
 assert.equal(params.get("selling_asset_type"),null);
});
test("M5 unconfigured reference market never makes a trading-data request",async()=>{
 let called=0;
 const r=await loadPairMarketData({registry:await registry(),marketId:"xlm-usdc-spot",fetchImpl:async()=>{called++;throw Error("must not fetch");}});
 assert.equal(r.state,"unconfigured");assert.equal(called,0);assert.equal(r.tradable,false);
 assert.equal(r.price,null);
});
test("M5 observed trade records come from verified current Testnet Horizon",async()=>{
 const calls=[];
 const trade={
  id:"5-0",ledger_close_time:new Date(NOW-10_000).toISOString(),
  base_asset_type:"native",counter_asset_type:"credit_alphanum4",
  counter_asset_code:"USDC",counter_asset_issuer:ADDR,
  base_amount:"10",counter_amount:"1"
 };
 const result=await loadRecentNetworkTrades({nowMs:NOW,fetchImpl:async(url)=>{
   calls.push(url);
   if(url===TESTNET_CONFIG.horizon+"/")return {ok:true,json:async()=>root()};
   if(url.startsWith(TESTNET_CONFIG.horizon+"/trades?"))return {ok:true,json:async()=>({_embedded:{records:[trade]}})};
   throw Error("bad request");
 }});
 assert.equal(result.state,"observed");
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].baseAmount,"10");
 assert.equal(result.tradable,false);
 assert.equal(result.price,null);
 assert.equal(calls.length,2);
});
test("M5 wrong Horizon network disables market-data activity",async()=>{
 let queriedTrades=false;
 const result=await loadRecentNetworkTrades({nowMs:NOW,fetchImpl:async(url)=>{
   if(url===TESTNET_CONFIG.horizon+"/")return {ok:true,json:async()=>({...root(),network_passphrase:"MAINNET"})};
   queriedTrades=true;throw Error("should not query trades");
 }});
 assert.equal(result.state,"unverified");assert.equal(queriedTrades,false);
});
test("M5 actual pair query and OHLC parses canonical endpoint parameters",async()=>{
 const calls=[];
 const result=await loadPairMarketData({registry:await configured(),marketId:"xlm-usdc-spot",interval:"1h",nowMs:NOW,
 fetchImpl:async url=>{
   calls.push(url);
   if(url===TESTNET_CONFIG.horizon+"/")return {ok:true,json:async()=>root()};
   if(url.includes("/order_book?"))return {ok:true,json:async()=>book()};
   if(url.includes("/trade_aggregations?"))return {ok:true,json:async()=>({_embedded:{records:[]}})};
   throw Error("bad request");
 }});
 assert.equal(result.state,"observed");
 assert.equal(result.book.mid,"0.15");
 assert.equal(result.tradable,false);
 assert.ok(calls.some(u=>u.includes("/order_book?")&&u.includes("base_asset_type=native")&&u.includes("counter_asset_code=USDC")));
 assert.ok(!calls.some(u=>u.includes("selling_asset_type")));
});
test("M5 rejects invalid issuer identities, crossed books and malformed prices",()=>{
 assert.throws(()=>normalizeOrderBook({...book(),base:usdc},{base:native,counter:usdc}),/identity/);
 assert.throws(()=>normalizeOrderBook({...book(),asks:[{price:"0.08",amount:"1"}]},{base:native,counter:usdc}),/Crossed/);
 assert.throws(()=>normalizeOrderBook({...book(),bids:[{price:"Infinity",amount:"1"}]},{base:native,counter:usdc}),/fixed-point/);
});
test("M5 valid candle aggregation remains deterministic",()=>{
 const at=Math.floor(NOW/3600000)*3600000-3600000;
 const rows=[{timestamp:String(at),open:"2",high:"2.5",low:"1.5",close:"2.1",base_volume:"10",counter_volume:"20",trade_count:3}];
 const candles=normalizeCandles(rows,"1h",NOW);
 assert.equal(candles.length,1);assert.equal(candles[0].close,"2.1");assert.equal(candles[0].trades,3);
 assert.equal(candles[0].tradable,false);
 assert.throws(()=>normalizeCandles([{...rows[0],high:"1"}],"1h",NOW),/Inconsistent/);
});
test("M5 oracle kill switch, stale sources, duplicate identity and deviant prices halt",()=>{
 const samples=[
 {sourceId:"a",marketId:"xlm-usdc-perp",timestampMs:NOW-1000,price:"1"},
 {sourceId:"b",marketId:"xlm-usdc-perp",timestampMs:NOW-2000,price:"1.01"}
 ];
 const base={marketId:"xlm-usdc-perp",nowMs:NOW};
 assert.equal(reviewOracle(samples,{...base,halt:true}).state,"halted");
 assert.equal(reviewOracle([samples[0]],{...base,halt:false}).state,"halted");
 assert.equal(reviewOracle([samples[0],samples[0]],{...base,halt:false}).state,"halted");
 assert.equal(reviewOracle(samples.map(s=>({...s,timestampMs:NOW-200000})),{...base,halt:false}).state,"halted");
 assert.equal(reviewOracle([samples[0],{...samples[1],price:"1.8"}],{...base,halt:false}).state,"halted");
 const preview=reviewOracle(samples,{...base,halt:false,markMid:"1.005"});
 assert.equal(preview.state,"candidate-only");assert.equal(preview.riskExecutable,false);
 assert.equal(reviewOracle(samples,{...base,halt:false,markMid:"1.2"}).state,"halted");
});
