import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Address,nativeToScVal,xdr} from "@stellar/stellar-sdk";
import {normalizeM59SpotEvent,readM59VerifiedSpotActivity}
  from "../verification/m59-m9-ledger-activity.mjs";
import {M9_TESTNET_CONTRACT_ID,TESTNET_PASSPHRASE}
  from "../app/m43-freighter-auth-guard.mjs";
import {M44_XLM_SAC,M44_USDC_SAC} from "../app/m44-stellar-xdr-verifier.mjs";
const maker="GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB";
const taker="GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2";
const scSymbol=s=>xdr.ScVal.scvSymbol(s),hash=id=>id.toString(16).padStart(2,"0").repeat(32);
function event({ledger=6500,amount=100000n,quote=17000n,txHash=hash(10),
  id=1,makerAddress=maker,takerAddress=taker,base=M44_XLM_SAC,
  quoteToken=M44_USDC_SAC}={}){
  return {
    type:"contract",contractId:M9_TESTNET_CONTRACT_ID,ledger,txHash,
    inSuccessfulContractCall:true,ledgerClosedAt:"2026-11-02T16:41:00Z",
    topic:[scSymbol("hoxo_spot"),scSymbol("settled"),
      xdr.ScVal.scvBytes(Uint8Array.from({length:32},()=>id))],
    value:xdr.ScVal.scvVec([
      new Address(makerAddress).toScVal(),
      new Address(takerAddress).toScVal(),
      new Address(base).toScVal(),
      new Address(quoteToken).toScVal(),
      nativeToScVal(amount,{type:"i128"}),
      nativeToScVal(quote,{type:"i128"}),
      xdr.ScVal.scvU32(ledger)
    ])
  };
}
function server({events=[event()],passphrase=TESTNET_PASSPHRASE,
  latest=7000,success=true,wrongLedger=false}={}){
  return {
    getNetwork:async()=>({passphrase}),
    getLatestLedger:async()=>({sequence:latest}),
    getEvents:async query=>{
      assert.equal(query.startLedger,Math.max(1,latest-3000));
      assert.equal(query.endLedger,latest);
      assert.deepEqual(query.filters,[{type:"contract",contractIds:[M9_TESTNET_CONTRACT_ID]}]);
      assert.ok(query.limit<=100);
      return {events,latestLedger:latest};
    },
    getTransaction:async h=>({hash:h,status:success?"SUCCESS":"FAILED",
      ledger:wrongLedger?6499:events.find(x=>x.txHash===h)?.ledger})
  };
}
test("M59 decodes real SDK SpotSettled vec, exact participants/assets, ledger and hash",()=>{
  const row=normalizeM59SpotEvent(event());
  assert.equal(row.ledger,6500);
  assert.equal(row.matchId,"01".repeat(32));
  assert.equal(row.baseAmountE7,"100000");
  assert.equal(row.quoteAmountE7,"17000");
  assert.equal(row.priceQuotePerXlm,.17);
  assert.equal(row.transactionHash,hash(10));
});
test("M59 aggregates only authentic finalized on-chain M9 settlement events",async()=>{
  const events=[event(),event({ledger:6501,id:2,txHash:hash(11),amount:200000n,quote:34000n})];
  const out=await readM59VerifiedSpotActivity({server:server({events})});
  assert.equal(out.network,"Stellar Testnet");
  assert.equal(out.contract,M9_TESTNET_CONTRACT_ID);
  assert.equal(out.verifiedCount,2);
  assert.equal(out.verifiedXlmVolumeE7,"300000");
  assert.equal(out.verifiedUsdcVolumeE7,"51000");
  assert.equal(out.isCompleteHistory,false);
  assert.equal(out.mocked,false);
  assert.equal(out.records.length,2);
  assert.equal(out.records[0].transactionHash,hash(11));
});
test("M59 empty verified Testnet window reports zero, NOT synthetic activity",async()=>{
  const out=await readM59VerifiedSpotActivity({server:server({events:[]})});
  assert.equal(out.verifiedCount,0);
  assert.equal(out.verifiedXlmVolumeE7,"0");
  assert.deepEqual(out.records,[]);
});
test("M59 fail closed on wrong network, failed transaction, bad ledger and spoofed assets",async()=>{
  await assert.rejects(readM59VerifiedSpotActivity({server:server({passphrase:"Public Global Stellar Network ; September 2015"})}),/not Stellar Testnet/);
  await assert.rejects(readM59VerifiedSpotActivity({server:server({success:false})}),/finality/);
  await assert.rejects(readM59VerifiedSpotActivity({server:server({wrongLedger:true})}),/finality/);
  for(const wrong of [
    event({base:M44_USDC_SAC}),event({takerAddress:maker}),event({amount:0n}),
    event({ledger:999999}),event({quote:0n})
  ])await assert.rejects(readM59VerifiedSpotActivity({server:server({events:[wrong]})}),
    /ledger|wallet|asset|amount|finality/);
});
test("M59 forbids repeated match IDs and never multiplies settled volume",async()=>{
  const repeated=[event(),event({txHash:hash(11),ledger:6501})];
  const out=await readM59VerifiedSpotActivity({server:server({events:repeated})});
  assert.equal(out.verifiedCount,1);
  assert.equal(out.verifiedXlmVolumeE7,"100000");
});
test("M59 public UI is Hoxo Testnet first; no Kraken chart/spot book or fake transactions",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const chart=await readFile(new URL("../app/m59-activity-ui.mjs",import.meta.url),"utf8");
  const endpoint=await readFile(new URL("../api/hoxo-testnet-activity.js",import.meta.url),"utf8");
  const book=await readFile(new URL("../app/m48-orderbook-ui.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(html,/KRAKEN|Kraken|m47-live-chart-ui\.mjs/);
  assert.match(html,/id="m59Volume"/);
  assert.match(html,/id="m59TradeRows"/);
  assert.match(html,/id="tradeButton"[^>]*class="trade-review"/);
  assert.match(chart,/hoxo-testnet-activity/);
  assert.match(book,/isPerp\?"hyperliquid-perp":"stellar-testnet"/);
  assert.doesNotMatch(chart,/Kraken|ws\.kraken|Math\.random\(/i);
  assert.doesNotMatch(endpoint,/sendTransaction|signAuthEntry|signTransaction/);
});
