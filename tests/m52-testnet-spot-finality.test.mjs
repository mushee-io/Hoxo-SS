import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {M52_SEND_ACK,verifyM52Receipt,reconcileM52Balances,
  m52ReviewedSpotSettlement} from "../app/m52-testnet-spot-finality.mjs";
import {M45_CANDIDATE} from "../app/m45-spot-preflight.mjs";
import {M44_XLM_SAC,M44_USDC_SAC}
  from "../app/m44-stellar-xdr-verifier.mjs";

const IDS=["a".repeat(64),"b".repeat(64),"c".repeat(64)];
const terms={
  match_id:IDS[0],maker_order_id:IDS[1],taker_order_id:IDS[2],
  maker:M45_CANDIDATE.maker,taker:M45_CANDIDATE.taker,
  base_token:M44_XLM_SAC,quote_token:M44_USDC_SAC,
  base_amount:"100000",quote_amount:"200000",
  maker_side:0,maker_limit_e7:"20000000",taker_limit_e7:"20000000",
  expires_at_ledger:5500100
};
const receipt={...terms,settled_ledger:5500050};
test("M52 exact signed M9 receipt verification rejects any amount, side or participant forgery",()=>{
  assert.equal(verifyM52Receipt(receipt,terms),5500050);
  for(const corrupted of [
    {...receipt,match_id:"0".repeat(64)},
    {...receipt,maker_order_id:IDS[2]},
    {...receipt,taker_order_id:IDS[1]},
    {...receipt,maker:terms.taker},
    {...receipt,base_amount:"100001"},
    {...receipt,quote_amount:"199999"},
    {...receipt,maker_side:1},
    {...receipt,settled_ledger:-1},
    {...receipt,quote_token:M44_XLM_SAC}
  ])assert.throws(()=>verifyM52Receipt(corrupted,terms),/receipt did not match/);
});
function balances({makerSells=true,fee=1000n}={}){
  const base=BigInt(terms.base_amount),quote=BigInt(terms.quote_amount);
  const before={
    [M44_XLM_SAC]:[100000000n,100000000n],
    [M44_USDC_SAC]:[1000000n,1000000n]
  };
  const xlm=makerSells?[-base,base]:[base,-base];
  const usdc=makerSells?[quote,-quote]:[-quote,quote];
  const after={
    [M44_XLM_SAC]:[before[M44_XLM_SAC][0]+xlm[0]-fee,
      before[M44_XLM_SAC][1]+xlm[1]],
    [M44_USDC_SAC]:[before[M44_USDC_SAC][0]+usdc[0],
      before[M44_USDC_SAC][1]+usdc[1]]
  };
  return {before,after};
}
test("M52 reconciles on-chain XLM and USDC transfer deltas for both BUY and SELL (source pays network fee)",()=>{
  const sell=balances({makerSells:true});
  assert.equal(reconcileM52Balances(sell.before,sell.after,terms,1000000n),true);
  const buy=balances({makerSells:false});
  assert.equal(reconcileM52Balances(buy.before,buy.after,{...terms,maker_side:1},1000000n),true);
  assert.throws(()=>reconcileM52Balances(sell.before,{
    ...sell.after,[M44_USDC_SAC]:[1200001n,800000n]
  },terms,1000000n),/USDC account/);
  assert.throws(()=>reconcileM52Balances(sell.before,{
    ...sell.after,[M44_XLM_SAC]:[99899000n,100100000n]
  },terms,1000000n),/XLM balance\/fee/);
  const excessive=balances({makerSells:true,fee:1000001n});
  assert.throws(()=>reconcileM52Balances(excessive.before,excessive.after,
    terms,1000000n),/XLM balance\/fee/);
  const wrongTaker=balances({makerSells:true});
  wrongTaker.after[M44_XLM_SAC][1]--;
  assert.throws(()=>reconcileM52Balances(wrongTaker.before,wrongTaker.after,
    terms,1000000n),/taker XLM/);
});
test("M52 has explicit no-send defaults, strong signed-XDR reconstruction and separate Testnet submit acknowledgement",async()=>{
  const body=await readFile(new URL("../app/m52-testnet-spot-finality.mjs",import.meta.url),"utf8");
  assert.equal(M52_SEND_ACK,"SEND_SMALL_HOXO_STELLAR_TESTNET_SPOT");
  assert.match(body,/createM44EnvelopePreparer/);
  assert.match(body,/reassembled.preparedTxXdr!==preparedTxXdr/);
  assert.match(body,/verifyM44TakerAuth/);
  assert.match(body,/verifyM44MakerEnvelope/);
  assert.match(body,/receipt.*exact signed settlement/);
  assert.match(body,/if\(send!==true\)/);
  assert.match(body,/acknowledgement!==M52_SEND_ACK/);
  assert.match(body,/queryContract/);
  assert.match(body,/sendTransaction\(tx\)/);
  assert.match(body,/pollTransaction\(hash\)/);
  assert.doesNotMatch(body,/set_pause\s*\(|signAndSend\s*\(/);
  let sends=0;
  await assert.rejects(m52ReviewedSpotSettlement({server:{
    async sendTransaction(){sends++;throw Error("must never send without full preflight");}
  },expectedTerms:terms,send:true,acknowledgement:M52_SEND_ACK}),/full official/);
  assert.equal(sends,0);
});
