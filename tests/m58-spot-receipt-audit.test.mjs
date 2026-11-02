import test from "node:test";
import assert from "node:assert/strict";
import {auditM58SpotPair,TESTNET_PASSPHRASE} from "../verification/m58-spot-receipt-audit.mjs";
const buy={txHash:"a".repeat(64),matchId:"b".repeat(64)};
const sell={txHash:"c".repeat(64),matchId:"d".repeat(64)};
const mk=(id,side,ledger,order)=>({match_id:id,maker_side:side,settled_ledger:ledger,
 maker:"G"+"A".repeat(55),taker:"G"+"B".repeat(55),
 maker_order_id:order.repeat(64),taker_order_id:(side===1?"2":"4").repeat(64),
 base_amount:"100000",quote_amount:"17000"});
const base={[buy.matchId]:mk(buy.matchId,1,55,"1"),[sell.matchId]:mk(sell.matchId,0,56,"3")};
function rpc({passphrase=TESTNET_PASSPHRASE,receipts=base,settled=true,status="SUCCESS"}={}){
 return {getNetwork:async()=>({passphrase}),
 getTransaction:async h=>({hash:h,status,ledger:h===buy.txHash?55:56}),
 queryContract:async(_c,m,args)=>({isReadCall:true,result:m==="receipt"?
 receipts[Buffer.from(args.match_id).toString("hex")]:settled})};
}
const run=(adapter=rpc(),b=buy,s=sell)=>auditM58SpotPair({rpc:adapter,
 contractId:"C"+"A".repeat(55),buy:b,sell:s});
test("M58 validates two finalized Testnet receipts but never certifies volume",async()=>{
 const p=await run();assert.equal(p.buyAndSellOnchainVerified,true);
 assert.equal(p.volumeAttributionApproved,false);assert.equal(p.proofs.length,2);
});
test("M58 rejects mainnet, duplicate evidence, failed finality and absent markers",async()=>{
 await assert.rejects(run(rpc({passphrase:"Public Global Stellar Network ; September 2015"})),/wrong network/);
 await assert.rejects(run(rpc(),buy,{...sell,txHash:buy.txHash}),/duplicate/);
 await assert.rejects(run(rpc({status:"FAILED"})),/finality/);
 await assert.rejects(run(rpc({settled:false})),/marker/);
 await assert.rejects(run(rpc(),buy,null),/both directions/);
});
test("M58 rejects self trades, incorrect side, forged ledger and reused order IDs",async()=>{
 for(const change of [{taker:"G"+"A".repeat(55)},{maker_side:0},
 {settled_ledger:57},{base_amount:100000},{maker_order_id:"2".repeat(64)}]){
 const receipts={...base,[buy.matchId]:{...base[buy.matchId],...change}};
 await assert.rejects(run(rpc({receipts})),/receipt|reused order/);
 }
 const receipts={...base,[sell.matchId]:{...base[sell.matchId],
 maker_order_id:base[buy.matchId].maker_order_id}};
 await assert.rejects(run(rpc({receipts})),/reused order/);
});
