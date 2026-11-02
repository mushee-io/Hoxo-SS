import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {normalizeKrakenCandles,parseKrakenOhlcMessage,mergeRealCandle,validateM47Request,
  M47_INTERVALS} from "../app/m47-live-candles.mjs";
import {getM47ReferenceCandles} from "../api/market-candles.js";

const start=1793576400;
function row(t,open="0.312000",high="0.317000",low="0.309000",close="0.315000",v="290"){
  return [t,open,high,low,close,"0.313000",v,16];
}
const feed={error:[],result:{XXLMZUSD:[row(start),row(start+60),row(start+120)],last:"1793577000"}};

test("M47 parses genuine Kraken REST OHLC into valid, ordered XLM/USD bars",()=>{
  const candles=normalizeKrakenCandles(feed,{nowSec:start+5000});
  assert.equal(candles.length,3);
  assert.equal(candles[0].time,start);
  assert.equal(candles[2].close,0.315);
  assert.equal(candles[0].high,0.317);
  assert.throws(()=>normalizeKrakenCandles({error:["invalid query"],result:{}}),/invalid Kraken/);
  assert.deepEqual(normalizeKrakenCandles({error:[],result:{XXLMZUSD:[
    row(start),row(start,"0.3000","0.1000","0.3090","0.3150")]}},
  {nowSec:start+5000}).length,1);
});


test("M47 rejects unrelated or ambiguous Kraken REST instruments",()=>{
  const opts={nowSec:start+5000};
  assert.throws(()=>normalizeKrakenCandles({error:[],result:{XXBTZUSD:[row(start)],last:"1"}},opts),/ambiguous or missing XLM\/USD/);
  assert.throws(()=>normalizeKrakenCandles({error:[],result:{XXLMZUSD:[row(start)],XLMUSD:[row(start)]}},opts),/ambiguous or missing XLM\/USD/);
  const legitimate={error:[],result:{XXBTZUSD:[row(start)],XXLMZUSD:[row(start)],last:"1"}};
  assert.equal(normalizeKrakenCandles(legitimate,opts)[0].time,start);
  assert.equal(normalizeKrakenCandles({error:[],result:{XLMUSD:[row(start)]}},opts).length,1);
});

test("M47 parses only real Kraken XLM/USD OHLC channel updates with interval matching",()=>{
  const packet=[42,
    ["1793576400.000","1793576460.000","0.312","0.318","0.310","0.317","0.315","420",12],
    "ohlc-1","XLM/USD"];
  const c=parseKrakenOhlcMessage(JSON.stringify(packet),{interval:1,nowSec:start+5000});
  assert.deepEqual(c,{time:start,open:0.312,high:0.318,low:0.310,close:0.317,volume:420});
  assert.equal(parseKrakenOhlcMessage(JSON.stringify(packet),{interval:30,nowSec:start+5000}),null);
  assert.equal(parseKrakenOhlcMessage(JSON.stringify([...packet.slice(0,3),"BTC/USD"]),{interval:1,nowSec:start+5000}),null);
  assert.equal(parseKrakenOhlcMessage("invalid json",{interval:1}),null);
  assert.equal(parseKrakenOhlcMessage(JSON.stringify({event:"heartbeat"}),{interval:1}),null);
});

test("M47 merges real streaming candles without generating intermediate fabricated bars",()=>{
  const base=normalizeKrakenCandles(feed,{nowSec:start+5000});
  const updated=mergeRealCandle(base,{...base[2],close:0.316,high:0.318,volume:300});
  assert.equal(updated.length,3);
  assert.equal(updated[2].close,0.316);
  const append=mergeRealCandle(updated,{...base[2],time:start+600,volume:1});
  assert.equal(append.length,4);
  assert.equal(append.at(-1).time,start+600);
  assert.deepEqual(mergeRealCandle(updated,{...base[2],close:0.01,volume:1}),updated,
    "stale lower-volume packet must not roll prices back");
});

test("M47 external market proxy restricts pair and interval and never reports executable Hoxo trades",async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    return {ok:true,json:async()=>feed};
  };
  const out=await getM47ReferenceCandles({symbol:"XLMUSD",interval:"1",
    fetchImpl,nowMs:(start+5000)*1000});
  assert.equal(out.source,"Kraken");
  assert.equal(out.pair,"XLM/USD");
  assert.equal(out.quoteCurrency,"USD");
  assert.equal(out.candles.length,3);
  assert.equal(out.executableQuote,false);
  assert.equal(out.hoxoTradingEnabled,false);
  assert.equal(out.verifiedHoxoFills,0);
  assert.match(calls[0].url,/pair=XLMUSD&interval=1/);
  assert.equal(calls[0].opts.method,"GET");
  assert.deepEqual(Object.values(M47_INTERVALS),[1,30,60,240,1440]);
  for(const input of [
    {symbol:"BTCUSD",interval:"1"},
    {symbol:"XLMUSDC",interval:"30"},
    {symbol:"XLMUSD",interval:"1;settle"},
    {symbol:"XLMUSD",interval:"999"}])
      assert.throws(()=>validateM47Request(input),/M47 candles/);
});

test("M47 price terminal labels Kraken USD reference and preserves disabled Hoxo wallet settlement",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m47-live-chart-ui.mjs",import.meta.url),"utf8");
  const main=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  for(const id of ["m47CandleCanvas","m47ChartSurface","m47SourceStatus","m47LastPrice",
     "m47LastPriceSource","marketPrice"])assert.match(html,new RegExp("id=\""+id+"\""));
  assert.match(html,/m47-live-chart-ui\.mjs/);
  assert.match(main,/hoxo:chart-selection/);
  assert.match(ui,/KRAKEN XLM\/USD/);
  assert.match(ui,/NOT HOXO FILLS/);
  assert.doesNotMatch(ui,/\.sendTransaction\(|\.signTransaction\(|set_pause\(false\)/);
  assert.match(html,/id="tradeButton"[^>]+disabled/);
});


test("M47 rejects future-dated streaming candles without synthesizing price movement",()=>{
  const packet=[42,[String(start),String(start+60),"0.312","0.318","0.310","0.317","0.315","420",12],"ohlc-1","XLM/USD"];
  assert.equal(parseKrakenOhlcMessage(packet,{interval:1,nowSec:start-1000}),null);
  assert.equal(parseKrakenOhlcMessage(packet,{interval:1,nowSec:start+5000})?.time,start);
});
