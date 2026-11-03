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
    assert.match(await page.locator("#marketSubheading").innerText(),/PERP · REFERENCE MARKET/);
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
    assert.equal(await page.locator("#bookEmptyTitle").innerText(),"TRADE HISTORY");
    assert.equal(await page.locator(".timeframes").isVisible(),false);
    await page.locator('[data-order-type="Limit"]').click();
    await page.locator("#orderSize").fill("1.25");
    await page.locator("#limitPrice").fill("15.50");
    assert.equal(await page.locator("#ticketNotional").innerText(),"19.375 USDC (input only)");
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.equal(await page.locator(".account-actions button:disabled").count(),2);
    await page.locator('[data-view="earn"]').click();
    assert.equal(await page.locator("#altTitle").innerText(),"EARN");
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
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
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
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
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
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
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
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.equal(await page.locator(".account-actions button:disabled").count(),2);
    assert.equal(await page.locator("#portfolioBody a").first().getAttribute("href"),
      "https://stellar.expert/explorer/testnet/tx/"+transaction);
    await page.locator('[data-portfolio-tab="Trade History"]').click();
    assert.match(await page.locator("#portfolioBody").innerText(),/NOT DEPLOYED/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M59 Chromium shows confirmed M9 transaction hashes and exact Testnet volume without Kraken market feeds",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const txA="a".repeat(64),txB="b".repeat(64);
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/hoxo-testnet-activity"))
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network:"Stellar Testnet",contract:"CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF",
        fromLedger:6000,throughLedger:6500,verifiedCount:2,
        verifiedXlmVolumeE7:"300000",verifiedUsdcVolumeE7:"51000",
        mocked:false,records:[
          {transactionHash:txB,ledger:6500,baseAmountE7:"200000",quoteAmountE7:"34000",priceQuotePerXlm:.17},
          {transactionHash:txA,ledger:6499,baseAmountE7:"100000",quoteAmountE7:"17000",priceQuotePerXlm:.17}
        ]
      })});
    if(url.startsWith(BASE+"/api/market-orderbook"))
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        source:"Stellar Horizon Testnet",sourceKind:"stellar-testnet",currency:"USDC",
        executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
        bids:[],asks:[],spread:null
      })});
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.locator("#m68ChartSource").selectOption("hoxo-m9");
    await page.locator("#m47ChartSurface").waitFor({state:"visible",timeout:15000});
    assert.match(await page.locator("#m59Volume").innerText(),/0\.03 XLM/);
    assert.match(await page.locator("#m59Summary").innerText(),/2 VERIFIED SETTLEMENTS/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    await page.locator('[data-book-view="trades"]').click();
    await page.locator("#m59Settlements").waitFor({state:"visible"});
    assert.equal(await page.locator("#m59TradeRows a").count(),2);
    const url=await page.locator("#m59TradeRows a").first().getAttribute("href");
    assert.ok(url.includes("/tx/"+txB));
    await page.locator('[data-chart-view="depth"]').click();
    assert.equal(await page.locator("#m47ChartSurface").isVisible(),false);
    await page.locator('[data-chart-view="price"]').click();
    await page.locator("#m47ChartSurface").waitFor({state:"visible"});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M59 Chromium defaults to genuine Stellar Testnet classic DEX depth and enables only reviewed spot ticket",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const hits=[];
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/market-orderbook?")){
      const source=new URL(url).searchParams.get("source");
      hits.push(source);
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        source:"Stellar Horizon Testnet",sourceKind:"stellar-testnet",currency:"USDC",
        executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
        bids:[{price:0.17,amount:7,total:1.19}],
        asks:[{price:0.18,amount:5,total:0.9}],spread:0.01
      })});
    }
    if(url.startsWith("https://horizon-testnet.stellar.org/order_book?"))
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        base:{asset_type:"native"},
        counter:{asset_type:"credit_alphanum4",asset_code:"USDC",
          asset_issuer:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"},
        bids:[{price_r:{n:108,d:1000},amount:"1000.0000000"}],
        asks:[{price_r:{n:248,d:1000},amount:"1000.0000000"}]
      })});
    if(url.startsWith(BASE+"/api/hoxo-testnet-activity"))
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network:"Stellar Testnet",contract:"CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF",
        fromLedger:6000,throughLedger:6500,verifiedCount:0,
        verifiedXlmVolumeE7:"0",verifiedUsdcVolumeE7:"0",records:[],mocked:false
      })});
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.locator(".m48-bid .m48-price").first().waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#m48BookSource").inputValue(),"stellar-testnet");
    assert.equal(await page.locator("#bookPriceHeading").innerText(),"PRICE (USDC)");
    assert.equal(await page.locator(".m48-ask .m48-price").count(),1);
    assert.equal(await page.locator(".m48-bid .m48-price").count(),1);
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.ok(hits.includes("stellar-testnet")&&!hits.includes("kraken"));
    await page.locator("#orderSize").fill("10");
    await page.locator("#tradeButton").click();
    await page.waitForFunction(()=>document.querySelector("#m63Quote")?.textContent
      .includes("Expected 2.4800000 USDC"));
    assert.equal(await page.locator("#m63Approve").isDisabled(),false);
    assert.equal(await page.locator("#m45SigningLab").isVisible(),false,
      "old internal M9 two-wallet process must not block the default Buy/Sell ticket");
    await page.locator("#m55OpenLab").click();
    assert.equal(await page.locator("#m45SigningLab").isVisible(),true);
    assert.equal(await page.locator("#m55Submit").isDisabled(),true,
      "advanced M9 settlement still requires separately approved signatures");
    await page.locator('[data-book-view="trades"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),false);
    assert.equal(await page.locator("#m59Settlements").isVisible(),true);
    await page.locator('[data-book-view="book"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),true);
    assert.deepEqual(errors,[]);
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
    assert.match(await page.locator("#m48BookSourceWarning").innerText(),/HYPERLIQUID · XLM-PERP/);
    assert.match(await page.locator("#m48BookStatus").innerText(),/LIVE DEPTH/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    assert.equal(await page.locator("#marketPrimaryStat").innerText(),"PERP REFERENCE PRICE");
    await page.locator(".announcement-details summary").click();
    assert.match(await page.locator(".announcement-panel").innerText(),/M9 spot settlement is deployed and has been independently verified unpaused/);
    await page.locator(".announcement-details summary").click();
    await page.locator('[data-book-view="trades"]').click();
    assert.equal(await page.locator("#m48BookFeed").isVisible(),false);
    await page.locator("#marketTrigger").click();
    await page.locator("#marketResults .market-item").filter({hasText:"XLM/USDC"}).first().click();
    assert.equal(await page.locator('[data-book-view="book"]').getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator("#m48BookSource").inputValue(),"stellar-testnet");
    await page.locator("#marketTrigger").click();
    await page.locator("#marketResults .market-item").filter({hasText:"XLM-PERP"}).first().click();
    await page.locator(".m48-bid .m48-price").first().waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#m48BookSource").inputValue(),"hyperliquid-perp");
    assert.ok(hits.includes("hyperliquid-perp"),JSON.stringify(hits));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M45 browser: controlled signing panel loads and remains non-executable while paused",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-spot",{width:1280,height:900});
  try{
    assert.equal(await page.locator("#m45SigningLab").isVisible(),false);
    await page.locator("#m55OpenLab").click();
    await page.locator("#m45SigningLab").waitFor({state:"visible"});
    assert.match(await page.locator("#m45NoSend").innerText(),/NO TRANSACTION SENT/);
    assert.match(await page.locator("#m45Contract").innerText(),/NOT VERIFIED/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.equal(await page.locator("#m45Prepare").isDisabled(),true);
    assert.equal(await page.locator("#m45SignTaker").isDisabled(),true);
    assert.equal(await page.locator("#m45SignMaker").isDisabled(),true);
    assert.equal(await page.locator("#m55Submit").isDisabled(),true);
    await page.locator("#m55SendAck").check();
    await page.locator("#m55SendPhrase").fill("SEND_SMALL_HOXO_STELLAR_TESTNET_SPOT");
    assert.equal(await page.locator("#m55Submit").isDisabled(),true,
      "final send confirmation alone never enables a trade without both Freighter signatures");
    await page.locator("#m45TermsAck").check();
    assert.equal(await page.locator("#m45Prepare").isDisabled(),true);
    await page.locator("#m45Check").click();
    await page.locator("#m45Check").waitFor({state:"visible"});
    await page.waitForFunction(()=>/Connect Freighter|G-addresses|Freighter|preflight|fetch|network|not verified|Failed/i
      .test(document.querySelector("#m45Status")?.textContent??""));
    assert.equal(await page.locator("#m45Prepare").isDisabled(),true);
    assert.equal(await page.locator("#m45SignTaker").isDisabled(),true);
    assert.equal(await page.locator("#m45SignMaker").isDisabled(),true);
    await page.locator("#m45Reset").click();
    assert.match(await page.locator("#m45NoSend").innerText(),/NO TRANSACTION SENT/);
    assert.deepEqual(errors,[],"M45 bundle must not produce unhandled page errors");
  }finally{await context.close();}
});


test("M62 public terminal never exposes the M46 Windows operator checklist",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-perp",{width:1280,height:900});
  try{
    assert.equal(await page.locator("#m46WindowsLab").count(),0);
    assert.equal(await page.locator("#m46VerifyWallet1").count(),0);
    assert.equal(await page.locator("#m45SigningLab").isVisible(),false);
    assert.equal(await page.locator("#marketAvailabilityBanner").isVisible(),true);
    assert.match(await page.locator("#marketAvailabilityTitle").innerText(),/PERPETUAL TRADING NOT DEPLOYED/);
    assert.equal(await page.locator("#tradeButton").isDisabled(),true);
    await page.locator("#switchToSpot").click();
    assert.equal(await page.locator("#marketLabel").innerText(),"XLM/USDC");
    assert.equal(await page.locator("#marketAvailabilityBanner").isVisible(),false);
    assert.equal(await page.locator("#m45SigningLab").isVisible(),false);
    assert.equal(await page.locator("#m63SpotSwap").isVisible(),true);
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M62 public spot screen has no internal Windows acceptance controls",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-spot");
  try{
    assert.equal(await page.locator("#m46WindowsLab").count(),0);
    assert.equal(await page.locator("#m45SigningLab").isVisible(),false);
    assert.equal(await page.locator("#m63SpotSwap").isVisible(),true);
    assert.equal(await page.locator("#marketAvailabilityBanner").isVisible(),false);
    assert.equal(await page.locator("#tradeButton").isDisabled(),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M68 Chromium renders actual Classic DEX OHLC candles, timeframe changes and explicit M9 source",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const hits=[];
  const t=Date.parse("2026-11-03T13:00:00Z");
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/xlm-usdc-candles")){
      const frame=new URL(url).searchParams.get("frame");
      hits.push(frame);
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network:"Stellar Testnet",venue:"Stellar Classic DEX",pair:"XLM/USDC",
        frame,source:"Official Stellar Horizon Testnet trade_aggregations",
        hoxoM9FillsAttributed:0,synthetic:false,
        candles:[{time:t-1800000,open:.16,high:.18,low:.15,close:.17,volume:14,trades:5},
          {time:t,open:.17,high:.18,low:.16,close:.175,volume:2,trades:2}]
      })});
    }
    if(url.startsWith(BASE+"/api/hoxo-testnet-activity"))
      return route.fulfill({status:503,contentType:"application/json",body:"{}"});
    if(url.startsWith(BASE+"/api/market-orderbook"))
      return route.fulfill({status:503,contentType:"application/json",body:"{}"});
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.locator("#m68DexChartSurface").waitFor({state:"visible",timeout:15000});
    assert.equal(await page.locator("#m68ChartSource").inputValue(),"stellar-dex");
    assert.match(await page.locator("#marketPrice").innerText(),/0\.1750000 USDC/);
    assert.match(await page.locator("#chartMarketStatus").innerText(),/CLASSIC DEX/);
    assert.match(await page.locator("#m47LastPriceSource").innerText(),/NOT HOXO M9/);
    assert.equal(await page.locator("#m47ChartSurface").isVisible(),false);
    await page.locator('[data-timeframe="1m"]').click();
    await page.waitForFunction(()=>document.querySelector("#chartMarketStatus")?.textContent
      .includes("1m"));
    assert.ok(hits.includes("1m"));
    await page.locator("#m68ChartSource").selectOption("hoxo-m9");
    assert.equal(await page.locator("#m68DexChartSurface").isVisible(),false);
    assert.equal(await page.locator(".timeframes").isVisible(),false);
    await page.locator("#m68ChartSource").selectOption("stellar-dex");
    await page.locator("#m68DexChartSurface").waitFor({state:"visible",timeout:15000});
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M69 Chromium displays real six-second resting bid/ask quote pulse independently of executed candles",async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const nowMs=Date.now();
  await context.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith(BASE+"/api/market-orderbook?")){
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        source:"Stellar Horizon Testnet",sourceKind:"stellar-testnet",currency:"USDC",
        executable:false,hoxoFills:false,tradeExecutable:false,
        hoxoSettlementEnabled:false,observedAtMs:nowMs,
        bids:[{price:.1642004,amount:.821002,total:.1348}],
        asks:[{price:.1675176,amount:5,total:.837588}],spread:.0033172
      })});
    }
    if(url.startsWith(BASE+"/api/xlm-usdc-candles")){
      const frame=new URL(url).searchParams.get("frame");
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        network:"Stellar Testnet",venue:"Stellar Classic DEX",frame,
        synthetic:false,hoxoM9FillsAttributed:0,
        candles:[{time:nowMs-3600000,open:.81,high:.82,low:.80,close:.81,volume:3,trades:1}]
      })});
    }
    if(url.startsWith(BASE+"/api/hoxo-testnet-activity"))
      return route.fulfill({status:503,contentType:"application/json",body:"{}"});
    if(url.startsWith(BASE+"/"))return route.continue();
    return route.abort();
  });
  const page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto(BASE+"/app/?market=xlm-usdc-spot",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.querySelector("#m69QuoteBid")?.textContent
      .includes("0.1642004"),null,{timeout:15000});
    assert.equal(await page.locator("#m69LiveQuotePanel").isVisible(),true);
    assert.equal(await page.locator("#m69QuoteAsk").innerText(),"0.1675176");
    assert.match(await page.locator("#m69QuoteStatus").innerText(),/REAL BOOK SNAPSHOT/);
    assert.match(await page.locator("#m69LiveQuotePanel").innerText(),/RESTING OFFERS/);
    assert.equal(await page.locator("#m69QuoteSpark").isVisible(),true);
    assert.equal(await page.locator("#currentTimeframe").innerText(),"1m");
    assert.match(await page.locator("#m47LastPriceSource").innerText(),/LAST EXECUTED TRADE/);
    assert.equal(await page.locator("#m68DexChartSurface").isVisible(),true);
    await page.locator("#m68ChartSource").selectOption("hoxo-m9");
    assert.equal(await page.locator("#m69LiveQuotePanel").isVisible(),false,
      "classic DEX quote pulse must not be mistaken for Hoxo M9 fills");
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M71 Lend nav opens the single Hoxo Lend entry card and preserves keyboard access",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-spot#lend");
  try{
    await page.locator("#lendView").waitFor({state:"visible",timeout:10000});
    assert.equal(await page.locator("#lendTitle").innerText(),"Enter the Lend Market");
    assert.equal(await page.locator('[data-view="lend"]').getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator("#tradeView").isVisible(),false);
    assert.equal(await page.locator("#alternateCards").isVisible(),false);
    assert.equal(await page.locator("#networkPanel").isVisible(),false);
    const link=page.locator("#lendView .lend-entry-card");
    assert.equal(await link.count(),1);
    assert.equal(await link.getAttribute("href"),"https://hoxo-lend.vercel.app/");
    assert.match(await link.innerText(),/HOXO\s+LEND/);
    assert.match(await link.innerText(),/Proceed with caution\./);
    assert.equal(await page.locator("#lendView button").count(),0);
    await link.focus();
    assert.equal(await link.evaluate(el=>el===document.activeElement),true);
    assert.match(page.url(),/#lend$/);
    await page.locator('[data-view="trade"]').click();
    assert.equal(await page.locator("#tradeView").isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test("M71 mobile Lend entry card fits the viewport and has no financial execution controls",async()=>{
  const {page,context,errors}=await openTerminal("/app/?market=xlm-usdc-spot#lend",{width:375,height:812});
  try{
    await page.locator("#lendView").waitFor({state:"visible",timeout:10000});
    const dimensions=await page.evaluate(()=>({
      pageWidth:document.documentElement.scrollWidth,
      viewportWidth:window.innerWidth
    }));
    assert.ok(dimensions.pageWidth<=dimensions.viewportWidth+2,JSON.stringify(dimensions));
    assert.equal(await page.locator("#lendView .lend-entry-card").isVisible(),true);
    assert.equal(await page.locator("#lendView .lend-entry-card").getAttribute("href"),"https://hoxo-lend.vercel.app/");
    assert.equal(await page.locator("#lendView button").count(),0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
