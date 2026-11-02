import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TESTNET} from "../assets/testnet-status.mjs";
import {normalizeM50Offer,normalizeM50Trade,loadM50ClassicDexPortfolio}
  from "../portfolio/m50-classic-dex.mjs";
import {getM50MoneyMarketRegistryStatus,previewM50EarnIntent}
  from "../portfolio/m50-earn.mjs";
const OWNER="GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB";
const OTHER="GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2";
const ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const NOW=Date.parse("2026-11-02T06:42:00Z");
const ledger=5500000;
const USDC={asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:ISSUER};
const XLM={asset_type:"native"};
const offer={id:"42",seller:OWNER,selling:XLM,buying:USDC,
  amount:"12.5000000",price:"0.20",price_r:{n:1,d:5},
  last_modified_ledger:ledger-4};
const trade={id:"120300-0",paging_token:"120300-0",
  ledger_close_time:new Date(NOW-30000).toISOString(),
  base_account:OWNER,counter_account:OTHER,trade_type:"orderbook",
  base_asset_type:"native",base_amount:"2.5000000",
  counter_asset_type:"credit_alphanum4",counter_asset_code:"USDC",
  counter_asset_issuer:ISSUER,counter_amount:"0.5000000"
};
function mock({offerRows=[offer],tradeRows=[trade],wrongNetwork=false,
  wrongAccount=false}={}){
  const calls=[];
  const fetchImpl=async (url,opts)=>{
    calls.push({url,method:opts.method,cache:opts.cache});
    let data;
    if(url===TESTNET.horizon+"/")data={
      network_passphrase:wrongNetwork?"Public Global Stellar Network ; September 2015":TESTNET.passphrase,
      history_latest_ledger:ledger,
      history_latest_ledger_closed_at:new Date(NOW-5000).toISOString()
    };
    else if(url===TESTNET.horizon+"/accounts/"+OWNER)data={
      account_id:wrongAccount?OTHER:OWNER,
      balances:[{asset_type:"native",balance:"1000.0000000"},
        {asset_type:"credit_alphanum4",asset_code:"USDC",
          asset_issuer:ISSUER,balance:"250.0000000"}]
    };
    else if(url.startsWith(TESTNET.horizon+"/accounts/"+OWNER+"/offers?"))
      data={_embedded:{records:offerRows}};
    else if(url.startsWith(TESTNET.horizon+"/accounts/"+OWNER+"/trades?"))
      data={_embedded:{records:tradeRows}};
    else throw Error("Unexpected URL "+url);
    return {ok:true,status:200,json:async()=>data};
  };
  return {fetchImpl,calls};
}

test("M50 normalizes exact account-owned Stellar classic DEX offers but never calls them Hoxo orders",()=>{
  const result=normalizeM50Offer(offer,OWNER,ledger);
  assert.equal(result.amount,"12.5000000");
  assert.equal(result.priceRatio.n,1);
  assert.equal(result.selling.code,"XLM");
  assert.equal(result.buying.issuer,ISSUER);
  assert.equal(result.hoxoOrder,false);
  assert.equal(result.tradeExecutable,false);
  for(const bad of [
    {...offer,seller:OTHER},{...offer,last_modified_ledger:ledger+1},
    {...offer,amount:"-1.0"},{...offer,buying:XLM},
    {...offer,price_r:{n:0,d:5}},{...offer,buying:{...USDC,asset_issuer:"GFAKE"}}
  ])assert.throws(()=>normalizeM50Offer(bad,OWNER,ledger));
});

test("M50 strict Horizon account trades are not fabricated Hoxo/perp fills or yield",()=>{
  const t=normalizeM50Trade(trade,OWNER,NOW);
  assert.equal(t.hoxoTrade,false);
  assert.equal(t.perpTrade,false);
  assert.equal(t.hoxoVolumeE7,"0");
  assert.equal(t.pnlE7,null);
  assert.equal(t.fundingE7,null);
  assert.equal(t.base.code,"XLM");
  assert.equal(t.counter.code,"USDC");
  assert.equal(t.direction,"BASE");
  for(const bad of [
    {...trade,base_account:OTHER,counter_account:OTHER},
    {...trade,paging_token:"not-the-id"},
    {...trade,base_amount:"1e5"},
    {...trade,trade_type:"hoxo"},
    {...trade,ledger_close_time:new Date(NOW+40000).toISOString()},
    {...trade,ledger_close_time:"1970-01-01T00:00:00.000Z"},
    {...trade,ledger_close_time:"2010-04-01T12:00:00.000Z"},
    {...trade,counter_asset_issuer:"GFAKE"}
  ])assert.throws(()=>normalizeM50Trade(bad,OWNER,NOW));
});

test("M50 portfolio verifies fresh Horizon Testnet and exact owner before reading offers/trades",async()=>{
  const m=mock();
  const p=await loadM50ClassicDexPortfolio(OWNER,{fetchImpl:m.fetchImpl,nowMs:NOW});
  assert.equal(p.owner,OWNER);
  assert.equal(p.ledger,ledger);
  assert.equal(p.balances.length,2);
  assert.equal(p.offers.length,1);
  assert.equal(p.trades.length,1);
  assert.equal(p.hoxoOrdersVerified,false);
  assert.equal(p.hoxoPositionsVerified,false);
  assert.equal(p.executionPermitted,false);
  assert.equal(p.offersCompleteness,"LATEST_20_ONLY");
  assert.deepEqual(m.calls.map(x=>x.method),["GET","GET","GET","GET"]);
  assert.ok(m.calls.every(x=>x.url.startsWith("https://horizon-testnet.stellar.org/")));
  await assert.rejects(loadM50ClassicDexPortfolio("GFAKE",{fetchImpl:m.fetchImpl,nowMs:NOW}),/invalid public/);
});

test("M50 rejects wrong network/account, duplicates, third-party forged offers and trade rows",async()=>{
  for(const options of [
    {wrongNetwork:true},{wrongAccount:true},
    {offerRows:[offer,{...offer}]},
    {offerRows:[{...offer,seller:OTHER}]},
    {tradeRows:[trade,{...trade}]},
    {tradeRows:[{...trade,base_account:OTHER,counter_account:OTHER}]}
  ]){
    const m=mock(options);
    await assert.rejects(loadM50ClassicDexPortfolio(OWNER,{fetchImpl:m.fetchImpl,nowMs:NOW}));
  }
});

test("M50 Earn rejects unsupported assets, wrong issuer, insufficient wallet holdings and never provides fictional APR",()=>{
  const registry={network:"testnet",passphrase:TESTNET.passphrase,
    contracts:[{role:"money-market",status:"planned",contractId:null}]};
  const status=getM50MoneyMarketRegistryStatus(registry);
  assert.equal(status.independentOnChainVerification,false);
  assert.equal(status.depositsEnabled,false);
  assert.equal(status.borrowEnabled,false);
  assert.equal(status.liveApy,null);
  assert.equal(status.capitalTransferPermitted,false);
  const plan=previewM50EarnIntent({owner:OWNER,issuer:ISSUER,asset:"USDC",
    amount:"3.2500000",walletBalance:"25.0000000"});
  assert.equal(plan.amountE7,"32500000");
  assert.equal(plan.projectedApy,null);
  assert.equal(plan.eligibleToSupply,false);
  assert.equal(plan.signingEnabled,false);
  assert.equal(plan.executionPermitted,false);
  for(const inputs of [
    {owner:OWNER,issuer:ISSUER,asset:"USDT",amount:"1",walletBalance:"25"},
    {owner:OWNER,issuer:"GFAKE",asset:"USDC",amount:"1",walletBalance:"25"},
    {owner:OWNER,issuer:ISSUER,asset:"USDC",amount:"30",walletBalance:"25"},
    {owner:OWNER,issuer:ISSUER,asset:"USDC",amount:"0",walletBalance:"25"},
    {owner:OWNER,issuer:ISSUER,asset:"USDC",amount:"1e4",walletBalance:"25"}
  ])assert.throws(()=>previewM50EarnIntent(inputs));
  assert.throws(()=>getM50MoneyMarketRegistryStatus({...registry,passphrase:"PUBLIC"}));
});

test("M50 MIT licence and portfolio/Earn controls are present, without signing or execution hooks",async()=>{
  const license=await readFile(new URL("../LICENSE",import.meta.url),"utf8");
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m50-views-ui.mjs",import.meta.url),"utf8");
  const wallet=await readFile(new URL("../app/wallet-ui.mjs",import.meta.url),"utf8");
  const terminal=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  assert.match(license,/^MIT License/);
  assert.match(license,/Copyright \(c\) 2026 Mushee/);
  for(const id of ["m50PortfolioView","m50EarnView","m50PortfolioContent",
     "m50EarnContent","m50EarnAsset","m50EarnAmount","m50EarnPreview"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/m50-views-ui\.mjs/);
  assert.match(wallet,/hoxo:wallet-state/);
  assert.match(wallet,/showClassicAccount/);
  assert.match(terminal,/m50PortfolioView/);
  assert.match(terminal,/m50EarnView/);
  assert.match(html,/id="tradeButton"[^>]+disabled/);
  assert.doesNotMatch(ui,/\.signTransaction\(|\.sendTransaction\(|\.signAuthEntry\(|set_pause\(false\)/);
});
