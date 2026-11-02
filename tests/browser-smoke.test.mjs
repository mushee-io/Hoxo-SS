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
    assert.equal(await page.locator(".infra-contract-row").count(),7);
    assert.ok(calls.includes("getNetwork")&&calls.includes("getHealth")&&calls.includes("getLatestLedger"));
    assert.match(await page.locator("#infraOverall").innerText(),/CONTRACTS NOT DEPLOYED/);
    await page.locator("#backToTrade").click();
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M18 Transfers tab shows verified Testnet public payment without presenting a HOXO trade",async()=>{
  const {page,context,errors}=await openWalletHarness();
  const transaction="a".repeat(64);
  await context.route("**/accounts/*/payments?*",async route=>{
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
      _embedded:{records:[{
        id:"123456789",paging_token:"123456789",
        transaction_successful:true,transaction_hash:transaction,
        type:"payment",created_at:new Date().toISOString(),
        from:TEST_G,to:TEST_G,amount:"2.5000000",asset_type:"native"
      }]}
    })});
  });
  try{
    await page.locator("#walletButton").click();
    await page.getByText("10000.0000000").waitFor();
    await page.locator('[data-portfolio-tab="Transfers"]').click();
    await page.getByText("2.5000000 XLM").waitFor();
    assert.match(await page.locator("#portfolioBody").innerText(),/NOT HOXO TRADES/);
    assert.match(await page.locator("#portfolioBody").innerText(),/PAYMENT · VIEW TX/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.equal(await page.locator(".account-actions button:disabled").count(),2);
    assert.equal(await page.locator("#portfolioBody a").first().getAttribute("href"),
      "https://stellar.expert/explorer/testnet/tx/"+transaction);
    await page.locator('[data-portfolio-tab="Trade History"]').click();
    assert.match(await page.locator("#portfolioBody").innerText(),/NOT DEPLOYED/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M47 Chromium terminal draws authentic-shaped Kraken OHLC fixture and changes timeframe without Hoxo execution",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const now=Math.floor(Date.now()/60000)*60;
  const intervals=[];
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/market-candles?")){
      const params=new URL(url).searchParams;
      const interval=Number(params.get("interval"));
      intervals.push(interval);
      const candles=Array.from({length:72},(_,i)=>{
        const minute=(now-71*interval*60)+i*interval*60;
        const base=0.31+(i%14)*0.0002;
        return {time:minute,open:base,high:base+0.001,low:base-0.001,
          close:base+0.0004,volume:100+i};
      });
      return route.fulfill({status:200,contentType:"application/json",
        body:JSON.stringify({source:"Kraken",pair:"XLM/USD",interval,
          venue:"External reference, not Hoxo",
          candles,executableQuote:false,verifiedHoxoFills:0})});
    }
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.locator("#m47ChartSurface").waitFor({state:"visible",timeout:12000});
    assert.match(await page.locator("#m47LastPriceSource").innerText(),/KRAKEN XLM\/USD.*NOT EXECUTABLE/);
    assert.match(await page.locator("#chartMarketStatus").innerText(),/KRAKEN EXTERNAL REFERENCE/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    const bitmap=await page.locator("#m47CandleCanvas").evaluate(c=>({
      width:c.width,height:c.height,
      pixel:c.getContext("2d").getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data.length
    }));
    assert.ok(bitmap.width>300&&bitmap.height>150,JSON.stringify(bitmap));
    await page.locator('[data-timeframe="1m"]').click();
    await page.waitForFunction(()=>document.querySelector("#m47SourceStatus")?.textContent.includes("1M"));
    assert.ok(intervals.includes(30)&&intervals.includes(1),JSON.stringify(intervals));
    await page.locator('[data-chart-view="depth"]').click();
    assert.equal(await page.locator("#m47ChartSurface").isVisible(),false);
    await page.locator('[data-chart-view="price"]').click();
    await page.locator("#m47ChartSurface").waitFor({state:"visible",timeout:12000});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});


test("M48 Chromium shows real-shaped red/green Kraken orderbook and switch to genuine Testnet offers",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const hits=[];
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/market-orderbook?")){
      const source=new URL(url).searchParams.get("source");
      hits.push(source);
      if(source==="kraken"){
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
          source:"Kraken",sourceKind:"kraken",currency:"USD",
          executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
          bids:[{price:0.168,amount:10,total:1.68}],
          asks:[{price:0.169,amount:9,total:1.521}],spread:0.001
        })});
      }
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        source:"Stellar Horizon Testnet",sourceKind:"stellar-testnet",currency:"USDC",
        executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
        bids:[{price:0.17,amount:7,total:1.19}],
        asks:[{price:0.18,amount:5,total:0.9}],spread:0.01
      })});
    }
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.locator(".m48-bid .m48-price").first().waitFor({state:"visible",timeout:15000});
    assert.match(await page.locator("#m48BookSourceWarning").innerText(),/KRAKEN XLM\/USD/);
    assert.equal(await page.locator("#bookPriceHeading").innerText(),"PRICE (USD)");
    assert.equal(await page.locator(".m48-ask .m48-price").count(),1);
    assert.equal(await page.locator(".m48-bid .m48-price").count(),1);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    await page.locator("#m48BookSource").selectOption("stellar-testnet");
    await page.waitForFunction(()=>document.querySelector("#bookPriceHeading")?.textContent==="PRICE (USDC)"&&
      document.querySelector("#m48BookStatus")?.textContent.includes("Stellar Horizon"));
    assert.match(await page.locator("#m48BookSourceWarning").innerText(),/CLASSIC DEX OFFERS/);
    assert.equal(await page.locator(".m48-ask .m48-price").count(),1);
    assert.ok(hits.includes("kraken")&&hits.includes("stellar-testnet"));
    await page.locator('[data-book-view="trades"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),false);
    await page.locator('[data-book-view="book"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),true);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.deepEqual(errors,[],"M48 must not throw in the browser");
  }finally{await context.close();}
});


test("M49 Chromium XLM-PERP opens real external perp depth by default and keeps Hoxo fills separate",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const hits=[];
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/market-orderbook?")){
      const source=new URL(url).searchParams.get("source");
      hits.push(source);
      if(source==="hyperliquid-perp")return route.fulfill({
        status:200,contentType:"application/json",
        body:JSON.stringify({
          sourceKind:"hyperliquid-perp",source:"Hyperliquid",
          marketType:"perpetual",market:"XLM perpetual",
          externalMainnet:true,quoteCurrency:"USD",currency:"USD",
          marginCurrency:"USDC",executable:false,hoxoFills:false,
          tradeExecutable:false,hoxoSettlementEnabled:false,
          bids:[{price:0.168,amount:13,total:2.184,orderCount:2}],
          asks:[{price:0.169,amount:12,total:2.028,orderCount:3}],
          spread:0.001,observedAtMs:Date.now()
        })
      });
      return route.fulfill({status:503,contentType:"application/json",
        body:JSON.stringify({error:"unavailable"})});
    }
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-perp",{waitUntil:"domcontentloaded"});
    await page.locator(".m48-bid .m48-price").first().waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#m48BookSource").inputValue(),"hyperliquid-perp");
    assert.equal(await page.locator("#bookPriceHeading").innerText(),"PRICE (USD)");
    assert.match(await page.locator("#m48BookSourceWarning").innerText(),/HYPERLIQUID XLM PERP/);
    assert.match(await page.locator("#m48BookStatus").innerText(),/Hyperliquid/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.equal(await page.locator("#marketPrimaryStat").innerText(),"REFERENCE PRICE");
    await page.locator(".announcement-details summary").click();
    assert.match(await page.locator(".announcement-panel").innerText(),/M9 spot settlement contract is deployed but paused/);
    await page.locator(".announcement-details summary").click();
    await page.locator('[data-book-view="trades"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),false);
    await page.locator("#marketTrigger").click();
    await page.locator("#marketResults .market-item").filter({hasText:"XLM/USDC"}).first().click();
    assert.equal(await page.locator('[data-book-view="book"]').getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator("#m48BookSource").inputValue(),"kraken");
    await page.locator("#marketTrigger").click();
    await page.locator("#marketResults .market-item").filter({hasText:"XLM-PERP"}).first().click();
    await page.locator(".m48-bid .m48-price").first().waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#m48BookSource").inputValue(),"hyperliquid-perp");
    assert.ok(hits.includes("hyperliquid-perp"),JSON.stringify(hits));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
