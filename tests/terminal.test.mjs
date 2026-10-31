import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {REFERENCE_MARKETS,DEFAULT_MARKET_ID,getMarket,filterMarkets,parseAmount7,orderDraft} from "../app/terminal-state.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("M2 catalog has deterministic unlisted spot and perp reference selections",()=>{
  assert.equal(REFERENCE_MARKETS.length,5);
  assert.equal(new Set(REFERENCE_MARKETS.map(x=>x.id)).size,REFERENCE_MARKETS.length);
  assert.equal(getMarket("not-listed").id,DEFAULT_MARKET_ID);
  assert.equal(getMarket("btc-usdc-perp").label,"BTC-PERP");
  assert.ok(REFERENCE_MARKETS.some(x=>x.type==="spot"));
  assert.ok(REFERENCE_MARKETS.some(x=>x.type==="perp"));
});
test("M2 market search and categories are functional",()=>{
  assert.equal(filterMarkets("btc").length,2);
  assert.equal(filterMarkets("xlm","spot").length,1);
  assert.equal(filterMarkets("xlm","perp").length,1);
  assert.equal(filterMarkets("","perp").length,3);
  assert.equal(filterMarkets("absent").length,0);
  assert.equal(filterMarkets("","invalid-category").length,5);
});
test("M2 order sizes use fixed 7 decimals, not JS floating point",()=>{
  assert.equal(parseAmount7("0.0000001"),1n);
  assert.equal(parseAmount7("1.2345678"),12345678n);
  for(const invalid of ["","0","-1","1.12345678","1e8","Infinity","NaN","1.2.3"," 1","001","1,000"]){
    assert.equal(parseAmount7(invalid),null,invalid);
  }
});
test("M2 market order draft never invents a quote",()=>{
  const result=orderDraft({marketId:"xlm-usdc-perp",orderType:"Market",size:"1.25"});
  assert.equal(result.valid,true);
  assert.equal(result.sizeLabel,"1.25 XLM");
  assert.equal(result.notional,"—");
  assert.match(result.message,/No verified market price/);
});
test("M2 limit draft is strictly user-input-only and non-executable",()=>{
  const result=orderDraft({marketId:"btc-usdc-spot",orderType:"Limit",size:"1.25",limitPrice:"15.50"});
  assert.equal(result.valid,true);
  assert.equal(result.notional,"19.375 USDC (input only)");
  assert.match(result.message,/Draft estimate only/);
  const invalid=orderDraft({marketId:"xlm-usdc-perp",orderType:"Limit",size:"1",limitPrice:"0"});
  assert.equal(invalid.valid,false);
  assert.equal(invalid.notional,"—");
});
test("M2 terminal exposes market selection, sections and disabled contract actions",async()=>{
  const html=await readFile(resolve(root,"app/index.html"),"utf8");
  const css=await readFile(resolve(root,"app/terminal.css"),"utf8");
  const ui=await readFile(resolve(root,"app/terminal-ui.mjs"),"utf8");
  const wallet=await readFile(resolve(root,"app/terminal.js"),"utf8");
  assert.match(html,/id="marketTrigger"/);
  assert.match(html,/id="marketSearch"/);
  assert.match(html,/id="marketResults"/);
  assert.match(html,/data-market-filter="spot"/);
  assert.match(html,/data-market-filter="perp"/);
  assert.match(html,/id="chartMarketStatus"/);
  assert.match(html,/data-timeframe="30m"/);
  assert.match(html,/id="limitPriceRow"/);
  assert.match(html,/<script src="\.\/terminal-ui\.mjs" type="module"><\/script>/);
  assert.match(html,/id="portfolioBody"/);
  assert.match(html,/disabled>EXECUTION UNAVAILABLE ON TESTNET/);
  assert.match(html,/<button disabled>DEPOSIT<\/button>/);
  assert.match(html,/<button disabled>WITHDRAW<\/button>/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(ui,/new URLSearchParams\(window.location.search\)/);
  assert.doesNotMatch(ui,/signTransaction|submitTransaction|sendTransaction|contract\.call/);
  assert.match(wallet,/probeTestnet/);
  const walletUi=await readFile(resolve(root,"app/wallet-ui.mjs"),"utf8");
  assert.match(walletUi,/createWalletSession/);
});
test("M2 browser entrypoints parse without syntax errors",()=>{
  for(const path of ["app/terminal-state.mjs","app/terminal-ui.mjs","app/terminal.js"]){
    assert.doesNotThrow(()=>execFileSync(process.execPath,["--check",resolve(root,path)],{stdio:"pipe"}),path);
  }
});
