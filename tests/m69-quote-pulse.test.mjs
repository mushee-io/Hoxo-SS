import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {checkedM69LiveBook,appendM69Quote} from "../app/m69-live-book-pulse.mjs";

const nowMs=1793713500000;
const book={
  source:"Stellar Horizon Testnet",sourceKind:"stellar-testnet",currency:"USDC",
  executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
  observedAtMs:nowMs,
  bids:[{price:.1642004,amount:.821002,total:.1348},{price:.108,amount:10,total:1.08}],
  asks:[{price:.1675176,amount:5,total:.837588},{price:.249,amount:2,total:.498}],
  spread:.0033172
};
test("M69 live bid/ask pulse shows actual fresh resting offers and explicitly no fills",()=>{
  const q=checkedM69LiveBook(book,{nowMs:nowMs+3000});
  assert.equal(q.bid,.1642004);
  assert.equal(q.ask,.1675176);
  assert.ok(Math.abs(q.spread-.0033172)<1e-10);
  assert.equal(q.source,"Verified live resting orders");
  assert.equal(q.venue,"Stellar Classic DEX");
  assert.equal(q.executedTrades,0);
  assert.equal(q.hoxoM9Fills,0);
  assert.equal(q.timestamp,nowMs);
  const arr=appendM69Quote([],q);
  assert.equal(arr.length,1);
  assert.equal(appendM69Quote(arr,q),arr,
    "Never fabricate additional samples without new observed time");
  assert.equal(appendM69Quote(arr,{...q,timestamp:nowMs+6000,bid:.1641,ask:.1676}).length,2);
});
test("M69 rejects stale, crossed, forged venues, missing depth and malformed snapshots",()=>{
  for(const bad of [
    {...book,sourceKind:"kraken"},
    {...book,currency:"USD"},
    {...book,hoxoFills:true},
    {...book,tradeExecutable:true},
    {...book,executable:true},
    {...book,hoxoSettlementEnabled:true},
    {...book,bids:[]},
    {...book,asks:[]},
    {...book,bids:[{price:0,amount:5}]},
    {...book,asks:[{price:.11,amount:1}]},
    {...book,observedAtMs:nowMs-30000},
    {...book,observedAtMs:nowMs+3000},
  ])assert.throws(()=>checkedM69LiveBook(bad,{nowMs}),/Unverified|Invalid|Stale|noncrossing/);
  assert.throws(()=>appendM69Quote([],{bid:1,ask:.5,timestamp:nowMs}),/Invalid/);
});
test("M69 records only observed quotes without synthetic fills and obeys sample cap",()=>{
  let records=[];for(let i=0;i<20;i++){
    records=appendM69Quote(records,{
      bid:.16+i/100000,ask:.17+i/100000,timestamp:nowMs+6000*i
    },{max:10});
  }
  assert.equal(records.length,10);
  assert.equal(records[0].timestamp,nowMs+60000);
  assert.equal(records.at(-1).timestamp,nowMs+114000);
});
test("M69 browser wires real 6-second orderbook to default 1m true trade candles",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m69-live-book-pulse-ui.mjs",import.meta.url),"utf8");
  const chart=await readFile(new URL("../app/m68-classic-dex-chart-ui.mjs",import.meta.url),"utf8");
  const terminal=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  assert.match(html,/m69-live-book-pulse-ui\.mjs/);
  assert.match(html,/id="m69LiveQuotePanel"/);
  assert.match(html,/id="m69QuoteSpark"/);
  assert.match(html,/data-timeframe="1m" class="active"/);
  assert.match(ui,/\/api\/market-orderbook\?source=stellar-testnet/);
  assert.match(ui,/setInterval\(\(\)=>\{if\(active\(\)\)void refresh\(\);\},6000\)/);
  assert.match(ui,/checkedM69LiveBook/);
  assert.match(html,/RESTING OFFERS/);
  assert.match(chart,/15\s*000|15000/);
  assert.match(terminal,/timeframe="1m"/);
  assert.doesNotMatch(ui,/Operation\.|signTransaction|submitTransaction|Keypair|setOffers/);
});
