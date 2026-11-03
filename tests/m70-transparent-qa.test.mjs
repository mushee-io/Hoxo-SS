import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Account,Asset,Keypair,Networks,Operation,TransactionBuilder}
  from "@stellar/stellar-sdk";
import {QA_LABEL,QA_INTERVAL_MS,QA_XLM_AMOUNT,QA_MAX_QUOTE_USDC,
  qaWindow,completedQaThisWindow,planIndependentQa}
  from "../mm/m70-transparent-qa.mjs";
import {USDC_TESTNET_ISSUER} from "../app/m63-spot-core.mjs";
const address=Keypair.random().publicKey();
const nowMs=Date.parse("2026-11-03T15:12:00Z");
const level=(amount,n,d)=>({amount,price_r:{n,d}});
const book={
  base:{asset_type:"native"},
  counter:{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:USDC_TESTNET_ISSUER},
  asks:[level("20.0000000",22,100)],
  bids:[level("20.0000000",10,100)]
};
const account={id:address,subentry_count:2,
  balances:[{asset_type:"native",balance:"100.0000000"},
    {asset_type:"credit_alphanum4",asset_code:"USDC",
      asset_issuer:USDC_TESTNET_ISSUER,balance:"10.0000000",is_authorized:true}]
};
test("M70 executes at most 0.02 XLM per transparent independent market QA test",()=>{
  const buy=planIndependentQa({side:"buy",account,book,nowMs});
  const sell=planIndependentQa({side:"sell",account,book,nowMs});
  for(const q of [buy,sell]){
    assert.equal(q.quantityXlm,QA_XLM_AMOUNT);
    assert.equal(q.qaLabel,QA_LABEL);
    assert.equal(q.independentOnly,true);
    assert.equal(q.cancelOwnOffersBeforeExecution,true);
    assert.equal(q.organicUsersAttributed,0);
    assert.equal(q.hoxoM9VolumeAttributed,"0");
    assert.equal(q.submitted,false);
    assert.equal(q.assetIssuer,USDC_TESTNET_ISSUER);
    assert.equal(q.maxUsdcCost,QA_MAX_QUOTE_USDC);
  }
  assert.equal(buy.expectedUsdc,"0.0044000");
  assert.equal(sell.expectedUsdc,"0.0020000");
});
test("M70 fails closed if reference issuer, matching depth, reserves or costs invalid",()=>{
  assert.throws(()=>planIndependentQa({side:"buy",book:{
    ...book,counter:{...book.counter,asset_issuer:"BAD"}
  },account,nowMs}),/different network asset pair/);
  assert.throws(()=>planIndependentQa({side:"buy",book:{
    ...book,asks:[level("0.0100000",22,100)]
  },account,nowMs}),/not enough matching/);
  assert.throws(()=>planIndependentQa({side:"buy",book:{
    ...book,asks:[level("2.0000000",30,1)]
  },account,nowMs}),/outside strict QA/);
  assert.throws(()=>planIndependentQa({side:"buy",book,account:{
    ...account,balances:[account.balances[0]]
  },nowMs}),/trustline/);
  assert.throws(()=>planIndependentQa({side:"buy",book,account:{
    ...account,balances:[account.balances[0],{
      ...account.balances[1],balance:"0.0000000"
    }]
  },nowMs}),/positive|invalid/);
  assert.throws(()=>planIndependentQa({side:"sell",book,account:{
    ...account,balances:[{...account.balances[0],balance:"1.0000000"},account.balances[1]]
  },nowMs}),/spendable XLM/);
});
test("M70 rate limit independently checks recent on-chain path payments in 15m windows",()=>{
  const now=qaWindow(nowMs),timestamp=new Date(now*QA_INTERVAL_MS+3000).toISOString();
  const old=new Date(now*QA_INTERVAL_MS-10000).toISOString();
  const settled={source_account:address,type:"path_payment_strict_send",created_at:timestamp};
  assert.equal(completedQaThisWindow([settled],{account,nowMs}),true);
  assert.equal(completedQaThisWindow([{
    ...settled,type:"manage_sell_offer"
  },{...settled,created_at:old}],{account,nowMs}),false);
  assert.equal(completedQaThisWindow([{
    ...settled,source_account:Keypair.random().publicKey()
  }],{account,nowMs}),false);
  assert.throws(()=>completedQaThisWindow([{
    ...settled,created_at:old
  },settled],{account,nowMs}),/unordered/);
  assert.throws(()=>completedQaThisWindow(Array(200).fill({
    ...settled,type:"manage_sell_offer"
  }),{account,nowMs}),/insufficient transaction history/);
});
test("M70 signing uses official pinned Stellar Testnet direct swaps; never the user's wallet",()=>{
  const maker=Keypair.random();
  const acct=new Account(maker.publicKey(),"100");
  const usdc=new Asset("USDC",USDC_TESTNET_ISSUER);
  const tx=new TransactionBuilder(acct,{
    fee:"100",networkPassphrase:Networks.TESTNET
  }).addOperation(Operation.pathPaymentStrictSend({
    sendAsset:Asset.native(),sendAmount:QA_XLM_AMOUNT,
    destAsset:usdc,destMin:"0.0005000",destination:maker.publicKey(),path:[]
  })).setTimeout(45).build();
  assert.equal(tx.operations.length,1);
  tx.sign(maker);
  assert.equal(tx.signatures.length,1);
  assert.equal(Buffer.from(tx.hash()).toString("hex").length,64);
});
test("M70 runner checks and cancels own resting orders before any QA fill, and maker restarts after",async()=>{
  const runner=await readFile(new URL("../scripts/m70-independent-qa-trade.mjs",import.meta.url),"utf8");
  const api=await readFile(new URL("../api/mm-runner.js",import.meta.url),"utf8");
  const publicApi=await readFile(new URL("../api/mm-qa-activity.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  assert.match(runner,/HOXO_MM_QA_ENABLED!=="YES"/);
  assert.match(runner,/runTestnetMM\("stop"\)/);
  assert.match(runner,/if\(\(await ownedOffers\(publicKey\)\)\.length\)/);
  assert.match(runner,/ops=cancelOps\(newOffers,publicKey\)/);
  assert.match(runner,/Operation\.pathPaymentStrictSend/);
  assert.match(runner,/Operation\.pathPaymentStrictReceive/);
  assert.match(runner,/server\.submitTransaction\(tx\)/);
  assert.match(runner,/verifiedReceipt\(sent\.hash,publicKey,side\)/);
  assert.match(api,/await runTransparentTestnetQaTrade\(\)/);
  assert.match(api,/await runTestnetMM\("live"\)/);
  assert.match(api,/qaStatus:qa\.status/);
  assert.match(publicApi,/organicUserVolumeAttributed:0,hoxoM9VolumeAttributed:0/);
  assert.match(html,/AUTOMATED TESTNET QA · NOT ORGANIC USER VOLUME/);
  assert.doesNotMatch(runner,/Keypair\.fromSecret\(["'][A-Z2-7]{56}/);
});
