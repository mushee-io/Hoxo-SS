import test from "node:test";
import assert from "node:assert/strict";
import {chromium} from "playwright";

const BASE="http://127.0.0.1:4173";
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,args:["--no-sandbox"]});});
test.after(async()=>{await browser?.close();});

async function openTerminal(path,viewport={width:1440,height:900}){
  const context=await browser.newContext({viewport});
  // External dependencies are blocked. Separate live Horizon CI checks verify Testnet availability.
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(BASE+path,{waitUntil:"domcontentloaded"});
  await page.locator("#marketLabel").waitFor({state:"visible"});
  return {page,context,errors};
}
test("M2 desktop: reference markets, tabs, non-executable order drafts",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=btc-usdc-perp");
  try{
    assert.equal(await page.locator("#marketLabel").innerText(),"BTC-PERP");
    assert.match(await page.locator("#marketSubheading").innerText(),/NOT LISTED/);
    await page.locator("#marketTrigger").click();
    await page.locator("#marketSearch").fill("xlm");
    await page.locator('[data-market-filter="spot"]').click();
    assert.equal(await page.locator("#marketResults .market-item").count(),1);
    await page.locator("#marketResults .market-item").click();
    assert.equal(await page.locator("#marketLabel").innerText(),"XLM/USDC");
    assert.match(page.url(),/market=xlm-usdc-spot/);
    await page.locator('[data-chart-view="depth"]').click();
    assert.equal(await page.locator("#chartEmptyTitle").innerText(),"DEPTH NOT DEPLOYED");
    await page.locator('[data-book-view="trades"]').click();
    assert.equal(await page.locator("#bookEmptyTitle").innerText(),"TRADES NOT DEPLOYED");
    await page.locator('[data-timeframe="1h"]').click();
    assert.match(await page.locator("#chartMarketStatus").innerText(),/1h/);
    await page.locator('[data-order-type="Limit"]').click();
    await page.locator("#orderSize").fill("1.25");
    await page.locator("#limitPrice").fill("15.50");
    assert.equal(await page.locator("#ticketNotional").innerText(),"19.375 USDC (input only)");
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.equal(await page.locator(".account-actions button:disabled").count(),2);
    await page.locator('[data-view="earn"]').click();
    assert.equal(await page.locator("#altTitle").innerText(),"MONEY MARKETS");
    await page.locator("#backToTrade").click();
    assert.equal(await page.locator("#marketLabel").innerText(),"XLM/USDC");
    assert.deepEqual(errors,[],"No unhandled page errors");
  }finally{await context.close();}
});
test("M2 deep-link portfolio and market selection",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-perp#portfolio");
  try{
    assert.equal(await page.locator("#altTitle").innerText(),"YOUR PORTFOLIO");
    assert.equal(await page.locator("#marketLabel").innerText(),"XLM-PERP");
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test("M2 mobile: market picker usable and no horizontal overflow",async()=>{
  const {page,context,errors}=await openTerminal("/app/",{width:375,height:812});
  try{
    const dimensions=await page.evaluate(()=>({
      pageWidth:document.documentElement.scrollWidth,
      viewportWidth:window.innerWidth,
    }));
    assert.ok(dimensions.pageWidth<=dimensions.viewportWidth+2,JSON.stringify(dimensions));
    await page.locator("#marketTrigger").click();
    assert.equal(await page.locator("#marketMenu").isVisible(),true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#marketMenu").isVisible(),false);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
