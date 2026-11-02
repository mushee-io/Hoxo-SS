import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {M41_SPOT_CANDIDATE} from "../activation/m41-spot-asset-readiness.mjs";
import {evaluateM53TestnetTrading,formatM53Markdown}
  from "../verification/m53-testnet-trading-checklist.mjs";

const OWNER=M41_SPOT_CANDIDATE.spotOwner;
const TAKER=M41_SPOT_CANDIDATE.otherTrader;
const registry={network:"testnet",passphrase:M41_SPOT_CANDIDATE.networkPassphrase,
  contracts:["spot-settlement","oracle-adapter","risk-engine","perp-clearinghouse","unified-margin"]
    .map(role=>({role,status:"planned",contractId:null}))};
const wallet=publicKey=>({
  publicKey,xlmE7:"25000000000",usdcE7:"100000000",
  usdcTrustlinePresent:true,usdcTrustlineAuthorized:true
});
const proof={
  milestone:"M41",network:"Stellar Testnet",
  contractId:M41_SPOT_CANDIDATE.spotContractId,
  baseSac:M41_SPOT_CANDIDATE.baseSac,
  quoteSac:M41_SPOT_CANDIDATE.quoteSac,
  deployedReadOnly:true,wasmHashVerified:true,ownerVerified:true,
  baseTokenDecimals:7,quoteTokenDecimals:7,
  baseAllowed:true,quoteAllowed:true,
  contractPaused:true,wallets:[wallet(OWNER),wallet(TAKER)],
  realSignedTradeVerified:false,confirmedVolumeE7:"0",executionPermitted:false
};
function item(report,id){
  const found=report.items.find(x=>x.id===id);
  assert.ok(found,id+" missing");
  return found;
}
test("M53 auto-checks only 7 proven chain/wallet gates, leaves paused and 12 execution gates unchecked",()=>{
  const r=evaluateM53TestnetTrading({m41:proof,registry,
    observedAt:"2026-11-02T10:40:26Z"});
  assert.equal(r.counts.total,20);
  assert.equal(r.counts.passed,7);
  assert.equal(r.counts.blocked,1);
  assert.equal(r.counts.pending,12);
  assert.equal(item(r,"spot_wasm").checked,true);
  assert.equal(item(r,"spot_assets").checked,true);
  assert.equal(item(r,"wallet_1_usdc").checked,true);
  assert.equal(item(r,"wallet_2_xlm").checked,true);
  assert.equal(item(r,"m9_unpaused").status,"blocked");
  for(const id of ["two_wallet_signing","spot_buy_receipt","spot_sell_receipt",
    "orderbook_matching","perp_perp-clearinghouse","perp_margin",
    "perp_long_receipt","perp_short_receipt"])
    assert.equal(item(r,id).checked,false,id);
  assert.equal(r.assetPreflightComplete,true);
  assert.equal(r.spotBuySellOperational,false);
  assert.equal(r.perpLongShortOperational,false);
  assert.equal(r.executionPermitted,false);
  assert.equal(r.broadcast,false);
  assert.match(formatM53Markdown(r),/- \[x\] \*\*Deployed M9 settlement binary verified/);
  assert.match(formatM53Markdown(r),/- \[ \] \*\*XLM spot BUY settled/);
});
test("M53 refuses to auto-check stale, wrong network or mismatched owner evidence",()=>{
  for(const update of [
    null,
    {...proof,network:"Stellar Mainnet"},
    {...proof,contractId:"C"+"A".repeat(55)},
    {...proof,wasmHashVerified:false},
    {...proof,baseSac:"invalid"},
    {...proof,wallets:[wallet(TAKER),wallet(OWNER)]},
    {...proof,wallets:[]}
  ]){
    const r=evaluateM53TestnetTrading({m41:update,registry});
    assert.equal(r.counts.passed,0);
    assert.equal(r.counts.unverified>=8,true);
    assert.equal(item(r,"spot_wasm").checked,false);
    assert.equal(r.executionPermitted,false);
  }
});
test("M53 missing USDC trustline, zero wallet or unapproved asset cannot pass funding",()=>{
  const r=evaluateM53TestnetTrading({m41:{
    ...proof,baseAllowed:false,quoteAllowed:true,
    wallets:[{...wallet(OWNER),usdcE7:"0",usdcTrustlineAuthorized:false},
      {...wallet(TAKER),xlmE7:"1"}]
  },registry});
  assert.equal(item(r,"spot_assets").status,"blocked");
  assert.equal(item(r,"wallet_1_usdc").status,"blocked");
  assert.equal(item(r,"wallet_2_xlm").status,"blocked");
  assert.equal(r.assetPreflightComplete,false);
});
test("M53 unpause signal alone cannot mark signed trading, fills or perpetuals complete",()=>{
  const rogueRegistry={...registry,contracts:registry.contracts.map(r=>({
    ...r,status:"verified",contractId:M41_SPOT_CANDIDATE.spotContractId
  }))};
  const r=evaluateM53TestnetTrading({m41:{
    ...proof,contractPaused:false,realSignedTradeVerified:true,
    confirmedVolumeE7:"500000000",tradingEnabled:true,executePermitted:true
  },registry:rogueRegistry});
  assert.equal(item(r,"m9_unpaused").checked,true);
  assert.equal(item(r,"spot_buy_receipt").checked,false);
  assert.equal(item(r,"spot_sell_receipt").checked,false);
  assert.equal(item(r,"perp_perp-clearinghouse").checked,false);
  assert.equal(r.spotBuySellOperational,false);
  assert.equal(r.perpLongShortOperational,false);
  assert.equal(r.executionPermitted,false);
  assert.equal(r.independentlyVerifiedTradingVolumeE7,"0");
});
test("M53 checker is read-only, emits transparent documented status without sign/submit or Vercel calls",async()=>{
  const script=await readFile(new URL("../scripts/check-m53-testnet-trading.mjs",import.meta.url),"utf8");
  const core=await readFile(new URL("../verification/m53-testnet-trading-checklist.mjs",import.meta.url),"utf8");
  const source=script+"\n"+core;
  for(const forbidden of [
    /\.sendTransaction\s*\(/, /\.signTransaction\s*\(/,
    /\.signAuthEntry\s*\(/, /\.set_pause\s*\(/,
    /\.signAndSend\s*\(/, /\.deploy\s*\(/,
    /\bexec(?:Sync)?\s*\([^)]*vercel\s+deploy/i
  ])assert.doesNotMatch(source,forbidden);
  assert.match(script,/probeM41SpotAssets/);
  assert.match(script,/testnet-trading\.json/);
  assert.match(script,/testnet-trading\.md/);
  assert.match(source,/userWalletSignatureStillRequired:true/);
});
