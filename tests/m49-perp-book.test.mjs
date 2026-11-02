import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validateM49PerpMeta,normalizeM49PerpBook} from "../app/m49-perp-book.mjs";
import {readM48OrderBook} from "../api/market-orderbook.js";

const NOW=1793576000000;
const meta={universe:[{name:"BTC",szDecimals:5},{name:"XLM",szDecimals:0}]};
const book={coin:"XLM",time:NOW-1200,levels:[
  [{px:"0.1680",sz:"1230.0",n:3},{px:"0.1675",sz:"88.0",n:1}],
  [{px:"0.1683",sz:"950.0",n:2},{px:"0.1690",sz:"27.0",n:1}]
]};
test("M49 confirms XLM is an actual listed Hyperliquid perpetual, never spot metadata",()=>{
  assert.deepEqual(validateM49PerpMeta(meta),{coin:"XLM",szDecimals:0,listed:true});
  assert.throws(()=>validateM49PerpMeta({universe:[{name:"BTC",szDecimals:5}]}),/not confirmed/);
  assert.throws(()=>validateM49PerpMeta({universe:[{name:"XLM",szDecimals:0,isDelisted:true}]}),/not confirmed/);
  assert.throws(()=>validateM49PerpMeta({universe:[{name:"XLM",szDecimals:0},{name:"XLM",szDecimals:0}]}),/not confirmed/);
  assert.throws(()=>validateM49PerpMeta({tokens:[{name:"XLM"}]}),/missing perp universe/);
  assert.throws(()=>validateM49PerpMeta({universe:[{name:"XLM",szDecimals:100}]}),/malformed/);
});
test("M49 parses exact XLM perpetual order depth and rejects fabricated or stale data",()=>{
  const out=normalizeM49PerpBook(book,{nowMs:NOW});
  assert.equal(out.source,"Hyperliquid");
  assert.equal(out.marketType,"perpetual");
  assert.equal(out.quoteCurrency,"USD");
  assert.equal(out.marginCurrency,"USDC");
  assert.equal(out.externalMainnet,true);
  assert.equal(out.bids[0].price,0.168);
  assert.equal(out.bids[0].orderCount,3);
  assert.equal(out.asks[0].price,0.1683);
  assert.ok(out.spread>0);
  assert.equal(out.executable,false);
  assert.equal(out.tradeExecutable,false);
  assert.equal(out.hoxoSettlementEnabled,false);
  assert.throws(()=>normalizeM49PerpBook({...book,coin:"BTC"},{nowMs:NOW}),/wrong\/stale/);
  assert.throws(()=>normalizeM49PerpBook({...book,time:NOW-31000},{nowMs:NOW}),/wrong\/stale/);
  assert.throws(()=>normalizeM49PerpBook({...book,time:NOW+11000},{nowMs:NOW}),/wrong\/stale/);
  assert.throws(()=>normalizeM49PerpBook({...book,levels:[
    book.levels[0],[{px:"0.1670",sz:"1",n:1}]
  ]},{nowMs:NOW}),/crossed/);
  assert.throws(()=>normalizeM49PerpBook({...book,levels:[
    [{px:"0.168",sz:"-2",n:1}],book.levels[1]
  ]},{nowMs:NOW}),/invalid bid size/);
});
test("M49 read-only endpoint fetches official perp meta and XLM l2Book only",async()=>{
  const calls=[];
  const read=async(url,options)=>{
    assert.equal(url,"https://api.hyperliquid.xyz/info");
    assert.equal(options.method,"POST");
    const body=JSON.parse(options.body);
    calls.push(body);
    return {ok:true,json:async()=>body.type==="meta"?meta:book};
  };
  const out=await readM48OrderBook({
    source:"hyperliquid-perp",fetchImpl:read,nowMs:NOW
  });
  assert.deepEqual(calls,[{type:"meta"},{type:"l2Book",coin:"XLM"}]);
  assert.equal(out.sourceKind,"hyperliquid-perp");
  assert.equal(out.market,"XLM perpetual");
  assert.equal(out.orderCount,4);
  assert.equal(out.executable,false);
  assert.equal(out.hoxoFills,false);
  assert.equal(out.tradeExecutable,false);
  assert.equal(out.hoxoSettlementEnabled,false);
  await assert.rejects(readM48OrderBook({
    source:"hyperliquid-perp",fetchImpl:async()=>({ok:false})
  }),/unavailable/);
  let onlyMeta=0;
  await assert.rejects(readM48OrderBook({
    source:"hyperliquid-perp",nowMs:NOW,
    fetchImpl:async()=>{onlyMeta++;return {ok:true,json:async()=>({universe:[{name:"ETH",szDecimals:4}]})};}
  }),/not confirmed/);
  assert.equal(onlyMeta,1,"do not show a perp orderbook if listing not verified");
});
test("M49 product status is transparent, shorter, and includes a real perp reference source",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m48-orderbook-ui.mjs",import.meta.url),"utf8");
  const terminal=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  assert.match(html,/LIVE XLM CHARTS/);
  assert.match(html,/<summary>PRODUCT STATUS<\/summary>/);
  assert.match(html,/M9 spot settlement contract is deployed but paused/);
  assert.match(html,/value="hyperliquid-perp"/);
  assert.match(html,/Live Order Book/);
  assert.doesNotMatch(html,/KRAKEN XLM\/USD · EXTERNAL SPOT ORDERS · NOT HOXO/);
  assert.match(html,/Hoxo Fills/);
  assert.doesNotMatch(html,/SPOT\/PERP EXECUTION, LENDING AND UNIFIED-MARGIN CONTRACTS ARE NOT YET DEPLOYED/);
  assert.match(ui,/Hyperliquid XLM perp/);
  assert.match(terminal,/bookView="book";selectGroup/);
  assert.match(terminal,/REFERENCE PRICE/);
  assert.doesNotMatch(terminal,/"MARK PRICE"/);
  assert.match(html,/id="tradeButton"[^>]+disabled/);
});
