import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import handler from "../api/xlm-usdc-candles.js";
import {M68_FRAMES,m68HorizonUrl,m68AggregateCandles,
  m68ReadHorizonCandles} from "../app/m68-classic-dex-candles.mjs";
import {USDC_TESTNET_ISSUER} from "../app/m63-spot-core.mjs";

const start=1793579400000;
const rec=(timestamp,open,high,low,close,volume,count="1")=>({
  timestamp:String(timestamp),open,high,low,close,base_volume:volume,trade_count:count
});
const payload={_embedded:{records:[
  rec(start,"0.1660000","0.1690000","0.1650000","0.1680000","2.0000000"),
  rec(start+900000,"0.1680000","0.1720000","0.1660000","0.1700000","3.0000000","2"),
  rec(start+1800000,"0.1700000","0.1730000","0.1670000","0.1710000","1.0000000")
]}};
const nowMs=Date.parse("2026-11-03T13:35:00Z");
test("M68 Horizon price source is exact native XLM/Circle Testnet USDC, never Kraken",()=>{
  const url=m68HorizonUrl({frame:"30m",nowMs});
  assert.equal(url.hostname,"horizon-testnet.stellar.org");
  assert.equal(url.pathname,"/trade_aggregations");
  assert.equal(url.searchParams.get("base_asset_type"),"native");
  assert.equal(url.searchParams.get("counter_asset_type"),"credit_alphanum4");
  assert.equal(url.searchParams.get("counter_asset_code"),"USDC");
  assert.equal(url.searchParams.get("counter_asset_issuer"),USDC_TESTNET_ISSUER);
  assert.equal(url.searchParams.get("resolution"),"900000");
  assert.equal(url.searchParams.get("limit"),"200");
  assert.equal(m68HorizonUrl({frame:"4h",nowMs}).searchParams.get("resolution"),"3600000");
  assert.deepEqual(Object.keys(M68_FRAMES),["1m","30m","1h","4h","1d"]);
  assert.throws(()=>m68HorizonUrl({frame:"10m",nowMs}),/unsupported/);
});
test("M68 converts only genuine sparse Horizon rows to OHLC/volume, with 30m aggregation",()=>{
  const out=m68AggregateCandles(payload,{frame:"30m"});
  assert.equal(out.length,2);
  assert.deepEqual(out[0],{
    time:start,open:.166,high:.172,low:.165,close:.17,volume:5,trades:3
  });
  assert.equal(out[1].time,start+1800000);
  assert.equal(out[1].close,.171);
  assert.equal(out[1].volume,1);
  const sparse={_embedded:{records:[payload._embedded.records[0],payload._embedded.records[2]]}};
  const parts=m68AggregateCandles(sparse,{frame:"30m"});
  assert.equal(parts.length,2);
  assert.equal(parts[0].volume,2);
  assert.equal(parts[1].volume,1);
  assert.deepEqual(m68AggregateCandles({_embedded:{records:[]}}),[]);
});
test("M68 rejects fabricated zero volume, duplicates, invalid OHLC and arbitrary sources",()=>{
  for(const bad of [
    {_embedded:{records:[rec(start,"0","0","0","0","0")]}},
    {_embedded:{records:[rec(start,"0.3","0.2","0.1","0.4","1")]}},
    {_embedded:{records:[rec(start,"0.3","0.4","0.5","0.2","1")]}},
    {_embedded:{records:[...payload._embedded.records,payload._embedded.records[0]]}},
    {_embedded:{records:[rec(start+1,"0.1","0.1","0.1","0.1","1")]}},
    {_embedded:{records:[rec(start,"0.1","0.1","0.1","0.1","1","0")]}},
    {candles:[{open:.1}]}
  ])assert.throws(()=>m68AggregateCandles(bad),/invalid|duplicated|malformed/);
});
test("M68 exposes a truthful read-only Horizon response, not Hoxo M9 fills",async()=>{
  let calls=0;
  const result=await m68ReadHorizonCandles({
    frame:"30m",nowMs,fetchImpl:async(url,options)=>{
      calls++;
      assert.match(url,/horizon-testnet\.stellar\.org\/trade_aggregations/);
      assert.equal(options.method,"GET");
      return {ok:true,json:async()=>payload};
    }
  });
  assert.equal(calls,1);
  assert.equal(result.network,"Stellar Testnet");
  assert.equal(result.venue,"Stellar Classic DEX");
  assert.equal(result.synthetic,false);
  assert.equal(result.hoxoM9FillsAttributed,0);
  assert.equal(result.candles.length,2);
  assert.throws(()=>m68AggregateCandles(payload,{frame:"unsupported"}),/unsupported/);
});
test("M68 API is read-only and rejects unsupported frames",async()=>{
  function res(){
    let statusCode=200;
    return {setHeader(){},status(n){statusCode=n;return this;},json(data){
      return {statusCode,body:data};}};
  }
  const invalid=await handler({method:"GET",query:{frame:"13m"}},res());
  assert.equal(invalid.statusCode,400);
  const post=await handler({method:"POST",query:{frame:"30m"}},res());
  assert.equal(post.statusCode,405);
});
test("M68 public UI defaults to REAL Classic DEX candles while retaining explicit M9-only fill data",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const m59=await readFile(new URL("../app/m59-activity-ui.mjs",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m68-classic-dex-chart-ui.mjs",import.meta.url),"utf8");
  assert.match(html,/id="m68ChartSource"/);
  assert.match(html,/<option value="stellar-dex" selected>/);
  assert.match(html,/<option value="hoxo-m9">/);
  assert.match(html,/id="m68DexCandleCanvas"/);
  assert.match(html,/m68-classic-dex-chart-ui\.mjs/);
  assert.match(ui,/\/api\/xlm-usdc-candles\?frame=/);
  assert.match(ui,/result\.synthetic!==false/);
  assert.match(ui,/result\.hoxoM9FillsAttributed!==0/);
  assert.match(m59,/isM9Chart/);
  assert.match(m59,/hoxo:chart-source/);
  assert.doesNotMatch(ui,/Kraken|faker|fakeCandles|Math\.random/);
});
