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


// M3: simulated Freighter extension integration in Chromium. This is not a
// substitute for manual acceptance with a genuine Freighter browser extension.
const TEST_G="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
async function openWalletHarness({funded=true,wrongNetwork=false}={}){
  let isFunded=funded,friendbotCalls=0;
  const context=await browser.newContext({viewport:{width:1280,height:820}});
  await context.addInitScript(({g,wrong})=>{
    let current="TESTNET";
    if(wrong) current="PUBLIC";
    window.__mockFreighter={
      changeNetwork(value){current=value;},
      changeAddress(value){window.__fakeAddress=value;}
    };
    window.__fakeAddress=g;
    window.freighterApi={
      async isConnected(){return {isConnected:true};},
      async requestAccess(){return {address:window.__fakeAddress};},
      async getAddress(){return {address:window.__fakeAddress};},
      async getNetwork(){return current==="TESTNET"
        ?{network:"TESTNET",networkPassphrase:"Test SDF Network ; September 2015"}
        :{network:"PUBLIC",networkPassphrase:"Public Global Stellar Network ; September 2015"};}
    };
  },{g:TEST_G,wrong:wrongNetwork});
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/"))return route.continue();
    if(url==="https://horizon-testnet.stellar.org/"){
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network_passphrase:"Test SDF Network ; September 2015",history_latest_ledger:9000123,
        history_latest_ledger_closed_at:new Date().toISOString()
      })});
    }
    if(url==="https://horizon-testnet.stellar.org/accounts/"+TEST_G){
      if(!isFunded)return route.fulfill({status:404,contentType:"application/json",body:'{"status":404}'});
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        account_id:TEST_G,balances:[{asset_type:"native",balance:"10000.0000000"}]
      })});
    }
    if(url.startsWith("https://friendbot.stellar.org/?addr=")){
      friendbotCalls++;isFunded=true;
      return route.fulfill({status:200,contentType:"application/json",body:'{"hash":"test-only-mock"}'});
    }
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(BASE+"/app/",{waitUntil:"domcontentloaded"});
  return {page,context,errors,friendbotCalls:()=>friendbotCalls};
}

test("M3 Freighter mock: connected Testnet wallet shows verified holdings, no execution",async()=>{
  const {page,context,errors}=await openWalletHarness();
  try{
    await page.locator("#walletButton").click();
    await page.getByText("10000.0000000").waitFor();
    assert.match(await page.locator("#walletStatus").innerText(),/CONNECTED/);
    assert.match(await page.locator("#accountAddress").innerText(),new RegExp(TEST_G));
    assert.equal(await page.locator("#faucetButton").isDisabled(),true);
    assert.equal(await page.locator("#refreshWallet").isDisabled(),false);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.equal(await page.locator(".account-actions button:disabled").count(),2);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test("M3 Freighter mock: mainnet connection is rejected and no holdings appear",async()=>{
  const {page,context,errors}=await openWalletHarness({wrongNetwork:true});
  try{
    await page.locator("#walletButton").click();
    await page.waitForFunction(()=>document.getElementById("walletStatus").textContent.includes("WRONG NETWORK"));
    assert.equal(await page.locator("#faucetButton").isDisabled(),true);
    assert.match(await page.locator("#accountAddress").innerText(),/No verified/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test("M3 Freighter mock: account is wiped when wallet changes to public network",async()=>{
  const {page,context,errors}=await openWalletHarness();
  try{
    await page.locator("#walletButton").click();
    await page.getByText("10000.0000000").waitFor();
    await page.evaluate(()=>{window.__mockFreighter.changeNetwork("PUBLIC");window.dispatchEvent(new Event("focus"));});
    await page.waitForFunction(()=>document.getElementById("walletStatus").textContent.includes("WRONG NETWORK"));
    assert.match(await page.locator("#accountAddress").innerText(),/No verified/);
    assert.equal(await page.locator("#refreshWallet").isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test("M3 Freighter mock: Friendbot never called before explicit confirmation",async()=>{
  const {page,context,errors,friendbotCalls}=await openWalletHarness({funded:false});
  try{
    await page.locator("#walletButton").click();
    await page.waitForFunction(()=>document.getElementById("walletStatus").textContent.includes("UNFUNDED"));
    assert.equal(friendbotCalls(),0);
    await page.locator("#faucetButton").click();
    assert.equal(await page.locator("#faucetConfirm").isVisible(),true);
    assert.equal(friendbotCalls(),0);
    await page.locator("#cancelFaucet").click();
    assert.equal(friendbotCalls(),0);
    await page.locator("#faucetButton").click();
    await page.locator("#confirmFaucet").click();
    await page.getByText("10000.0000000").waitFor();
    assert.equal(friendbotCalls(),1);
    assert.equal(await page.locator("#faucetButton").isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});


test("M4 Testnet network panel verifies Horizon/RPC and never claims deployed exchange",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const calls=[];
  const at=Math.floor(Date.now()/1000)-5;
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/"))return route.continue();
    if(url==="https://horizon-testnet.stellar.org/"){
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network_passphrase:"Test SDF Network ; September 2015",
        history_latest_ledger:1000000,
        history_latest_ledger_closed_at:new Date(at*1000).toISOString()
      })});
    }
    if(url==="https://soroban-testnet.stellar.org"||url==="https://soroban-testnet.stellar.org/"){
      const input=route.request().postDataJSON();
      calls.push(input.method);
      const result={
        getNetwork:{passphrase:"Test SDF Network ; September 2015",protocolVersion:23},
        getHealth:{status:"healthy",latestLedger:1000000,oldestLedger:999000,latestLedgerCloseTime:String(at),ledgerRetentionWindow:120960},
        getLatestLedger:{sequence:1000000,closeTime:String(at),protocolVersion:23}
      }[input.method];
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:input.id,result})});
    }
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot#network",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.getElementById("infraOverall").textContent.includes("TESTNET CONNECTED"),null,{timeout:8000});
    assert.equal(await page.locator("#infraHorizonStatus").innerText(),"VERIFIED");
    assert.equal(await page.locator("#infraRpcStatus").innerText(),"VERIFIED");
    assert.equal(await page.locator("#infraRegistryStatus").innerText(),"REGISTRY VALID");
    assert.equal(await page.locator("#infraVerifiedContracts").innerText(),"0");
    assert.equal(await page.locator(".infra-contract-row").count(),6);
    assert.ok(calls.includes("getNetwork")&&calls.includes("getHealth")&&calls.includes("getLatestLedger"));
    assert.match(await page.locator("#infraOverall").innerText(),/CONTRACTS NOT DEPLOYED/);
    await page.locator("#backToTrade").click();
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
