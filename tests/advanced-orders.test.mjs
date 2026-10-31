import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {canonicalPayload,TESTNET_PASSPHRASE} from "../matching/auth.mjs";
import {emptyBook,projectCommand,orderTransitions,advancedOrderById,simulatedPosition,snapshot} from "../matching/core.mjs";
import {SignedOrderJournal} from "../matching/journal.mjs";
import {createSandboxServer} from "../matching/http.mjs";
const NOW=1_800_000_000_000;
const MARKET="xlm-usdc-perp";
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encodeG(publicKey){
  const raw=publicKey.export({format:"der",type:"spki"}).subarray(-32);
  const bytes=Buffer.concat([Buffer.from([48]),raw]);
  let crc=0;
  for(const byte of bytes){
    crc^=byte<<8;
    for(let i=0;i<8;i++)crc=crc&0x8000?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  const all=Buffer.concat([bytes,Buffer.from([crc&255,crc>>8])]);
  let buffer=0,bits=0,result="";
  for(const value of all){
    buffer=(buffer<<8)|value;bits+=8;
    while(bits>=5){bits-=5;result+=ALPHABET[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}
  }
  if(bits)result+=ALPHABET[(buffer<<(5-bits))&31];
  return result;
}
function wallet(){
  const pair=generateKeyPairSync("ed25519");
  return {owner:encodeG(pair.publicKey),
    sign(command){return sign(null,canonicalPayload(command),pair.privateKey).toString("base64url");}};
}
const A=wallet(),B=wallet(),C=wallet(),D=wallet();
function legacy(actor,nonce,id,side,price,quantity,marketId=MARKET){
  return {type:"place",networkPassphrase:TESTNET_PASSPHRASE,owner:actor.owner,
    nonce,clientOrderId:id,marketId,side,priceE7:price,
    quantityE7:quantity,expiresAtMs:NOW+600_000};
}
function advanced(actor,nonce,id,side,orderType,price,quantity,
  trigger="0",protection="0",reduceOnly=false,marketId=MARKET,expires=NOW+600_000){
  return {type:"advanced_place",networkPassphrase:TESTNET_PASSPHRASE,
    owner:actor.owner,nonce,clientOrderId:id,marketId,side,orderType,
    priceE7:price,quantityE7:quantity,triggerPriceE7:trigger,
    protectionPriceE7:protection,reduceOnly,expiresAtMs:expires};
}
function cancel(actor,nonce,id){
  return {type:"advanced_cancel",networkPassphrase:TESTNET_PASSPHRASE,
    owner:actor.owner,nonce,orderId:id};
}
function tick(actor,nonce,price,observedAtMs=NOW+100,marketId=MARKET){
  return {type:"sandbox_tick",networkPassphrase:TESTNET_PASSPHRASE,
    owner:actor.owner,nonce,marketId,markPriceE7:price,observedAtMs};
}
const step=(state,command,ms=NOW,options={})=>projectCommand(state,command,ms,options);
function withPosition(){
  let state=emptyBook();
  state=step(state,legacy(B,1,"shortseed","sell","10","10")).state;
  state=step(state,legacy(A,1,"longseed","buy","10","10"),NOW+1).state;
  assert.equal(simulatedPosition(state,A.owner,MARKET).quantityE7,"10");
  assert.equal(simulatedPosition(state,B.owner,MARKET).side,"SHORT");
  return state;
}
async function temporary(t){
  const folder=await mkdtemp(join(tmpdir(),"hoxo-m17-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return join(folder,"advanced.jsonl");
}
test("M17 price-protected market order is immediate-or-cancel and never rests",()=>{
  let state=emptyBook();
  state=step(state,legacy(B,1,"ask","sell","9","2","xlm-usdc-spot")).state;
  const c=advanced(A,1,"market","buy","market","0","3","0","10",false,"xlm-usdc-spot");
  const result=step(state,c,NOW+1);
  assert.equal(result.result.simulatedFills.length,1);
  assert.equal(result.result.simulatedFills[0].quantityE7,"2");
  assert.equal(result.result.remainingE7,"0");
  assert.equal(result.state.orders.size,0);
  assert.equal(result.result.executionPermitted,false);
  assert.equal(orderTransitions(result.state,A.owner+":market").at(-1).to,"IOC_PARTIAL");
  assert.equal(result.result.simulatedFills[0].settlement,"NOT_SETTLED");
  assert.equal(result.result.simulatedFills[0].advancedSandbox,true);
});
test("M17 market protection never sweeps a worse price or leaves phantom liquidity",()=>{
  let state=emptyBook();
  state=step(state,legacy(B,1,"ask","sell","10","2","xlm-usdc-spot")).state;
  const result=step(state,advanced(A,1,"blocked","buy","market","0","2","0","9.99",
    false,"xlm-usdc-spot"),NOW+1);
  assert.equal(result.result.simulatedFills.length,0);
  assert.equal(result.state.orders.size,1);
  assert.equal(orderTransitions(result.state,A.owner+":blocked").at(-1).to,"IOC_UNFILLED");
});
test("M17 signed limit orders retain price-time priority and auditable cancellation",()=>{
  let state=emptyBook();
  const first=advanced(A,1,"buy1","buy","limit","8","2");
  const second=advanced(C,1,"buy2","buy","limit","8","1");
  state=step(state,first).state;
  state=step(state,second,NOW+1).state;
  assert.deepEqual(snapshot(state,MARKET).bids.map(x=>x.id),[A.owner+":buy1",C.owner+":buy2"]);
  assert.equal(advancedOrderById(state,A.owner+":buy1").status,"RESTING");
  assert.throws(()=>step(state,cancel(B,2,A.owner+":buy1"),NOW+2),/ownership mismatch/);
  const next=step(state,cancel(A,2,A.owner+":buy1"),NOW+2);
  assert.equal(next.state.orders.size,1);
  assert.deepEqual(orderTransitions(next.state,A.owner+":buy1").map(x=>x.to),["RESTING","CANCELLED"]);
  assert.equal(next.result.executionPermitted,false);
  assert.equal(state.orders.size,2,"Invalid mutation must not change earlier state");
});
test("M17 TP/SL require established simulated perp exposure and strict protection prices",()=>{
  const no=emptyBook();
  assert.throws(()=>step(no,advanced(A,1,"stop","sell","stop_loss_market",
    "0","1","9","8",true)),/Reduce-only exceeds/);
  assert.throws(()=>step(no,advanced(A,1,"bad","sell","take_profit_market",
    "0","1","11","10",false)),/reduceOnly=true/);
  assert.throws(()=>step(no,advanced(A,1,"unbounded","buy","market",
    "0","1","0","0",false)),/price-protection/);
  assert.throws(()=>step(no,advanced(A,1,"wrong","buy","limit",
    "9","1","9","0",false)),/cannot carry a trigger/);
  assert.throws(()=>step(no,advanced(A,1,"wrong2","buy","limit",
    "9","1","0","8",false)),/Limit execution requires/);
  assert.equal(no.sequence,0);
});
test("M17 signed stop-loss tick triggers a reduce-only protected IOC, not on-chain trade",()=>{
  let state=withPosition();
  state=step(state,legacy(C,1,"bid","buy","8.5","4"),NOW+2).state;
  const stop=advanced(A,2,"sl","sell","stop_loss_market","0","4","9","8",true);
  state=step(state,stop,NOW+3).state;
  assert.equal(state.conditionals.size,1);
  assert.equal(state.orders.has(A.owner+":sl"),false);
  assert.equal(advancedOrderById(state,A.owner+":sl").status,"PENDING_TRIGGER");
  assert.throws(()=>step(state,tick(C,2,"8.9",NOW+4),NOW+4),/separately configured/);
  const result=step(state,tick(D,1,"8.9",NOW+4),NOW+4,{tickSigner:D.owner});
  assert.deepEqual(result.result.triggeredConditionalIds,[A.owner+":sl"]);
  assert.equal(result.result.simulatedFills.length,1);
  assert.equal(result.result.simulatedFills[0].priceE7,"8.5");
  assert.equal(simulatedPosition(result.state,A.owner,MARKET).quantityE7,"6");
  assert.equal(result.state.conditionals.size,0);
  assert.equal(result.result.settlement,"NOT_SETTLED");
  assert.deepEqual(orderTransitions(result.state,A.owner+":sl").map(x=>x.to),
    ["PENDING_TRIGGER","TRIGGERED","SIMULATED_FILLED"]);
  assert.equal(result.state.markTicks.get(MARKET).source,"SIGNED_SANDBOX_OPERATOR_NOT_M5_ORACLE");
});
test("M17 take-profit condition uses the inverse direction and can place limit residue",()=>{
  let state=withPosition();
  const take=advanced(A,2,"tp","sell","take_profit_limit","11","3","11","0",true);
  state=step(state,take,NOW+2).state;
  const nonTrigger=step(state,tick(D,1,"10.99",NOW+3),NOW+3,{tickSigner:D.owner});
  assert.equal(nonTrigger.result.triggeredConditionalIds.length,0);
  state=nonTrigger.state;
  const triggered=step(state,tick(D,2,"11",NOW+4),NOW+4,{tickSigner:D.owner});
  assert.deepEqual(triggered.result.triggeredConditionalIds,[A.owner+":tp"]);
  assert.equal(triggered.result.simulatedFills.length,0);
  assert.equal(advancedOrderById(triggered.state,A.owner+":tp").status,"RESTING");
  assert.equal(triggered.state.orders.get(A.owner+":tp").priceE7,"11");
  assert.equal(simulatedPosition(triggered.state,A.owner,MARKET).quantityE7,"10");
});
test("M17 buy stop-loss for a simulated short triggers only when mark rises",()=>{
  let state=withPosition();
  state=step(state,legacy(C,1,"ask11","sell","11","2"),NOW+2).state;
  state=step(state,advanced(B,2,"shortstop","buy","stop_loss_market",
    "0","2","11","12",true),NOW+3).state;
  const off=step(state,tick(D,1,"10.9",NOW+4),NOW+4,{tickSigner:D.owner});
  assert.equal(off.result.simulatedFills.length,0);
  const on=step(off.state,tick(D,2,"11.2",NOW+5),NOW+5,{tickSigner:D.owner});
  assert.equal(on.result.simulatedFills.length,1);
  assert.equal(simulatedPosition(on.state,B.owner,MARKET).side,"SHORT");
  assert.equal(simulatedPosition(on.state,B.owner,MARKET).quantityE7,"8");
});
test("M17 reduce-only reservations prevent two exits from consuming one simulated position",()=>{
  let state=withPosition();
  state=step(state,advanced(A,2,"one","sell","stop_loss_market",
    "0","8","9","8",true),NOW+2).state;
  assert.throws(()=>step(state,advanced(A,3,"two","sell","take_profit_market",
    "0","3","11","10",true),NOW+3),/uncommitted SIMULATED position/);
  assert.equal(state.conditionals.size,1);
  assert.equal(state.nonces.get(A.owner),2);
});
test("M17 reduces resting maker only up to current simulated position",()=>{
  let state=withPosition();
  state=step(state,advanced(A,2,"makerreduce","sell","limit","12","5","0","0",true),NOW+2).state;
  state=step(state,legacy(C,1,"buy2","buy","12","3"),NOW+3).state;
  assert.equal(simulatedPosition(state,A.owner,MARKET).quantityE7,"7");
  assert.equal(advancedOrderById(state,A.owner+":makerreduce").remainingE7,"2");
  const fills=step(state,legacy(D,1,"buy10","buy","12","10"),NOW+4);
  assert.equal(fills.result.simulatedFills[0].quantityE7,"2");
  assert.equal(simulatedPosition(fills.state,A.owner,MARKET).quantityE7,"5");
  assert.equal(fills.state.orders.has(A.owner+":makerreduce"),false);
});
test("M17 stale, future, replayed and wrong-operator signed marks fail atomically",()=>{
  let state=withPosition();
  state=step(state,advanced(A,2,"stop2","sell","stop_loss_market",
    "0","1","9","8",true),NOW+2).state;
  const options={tickSigner:D.owner};
  assert.throws(()=>step(state,tick(C,2,"8.9",NOW+3),NOW+3,options),/operator/);
  assert.throws(()=>step(state,tick(D,1,"8.9",NOW-200_000),NOW+3,options),/Stale/);
  assert.throws(()=>step(state,tick(D,1,"8.9",NOW+4),NOW+3,options),/future/);
  assert.equal(state.markTicks.size,0);
  const accepted=step(state,tick(D,1,"10",NOW+3),NOW+3,options).state;
  assert.throws(()=>step(accepted,tick(D,2,"10",NOW+3),NOW+4,options),/non-monotonic/);
  assert.equal(accepted.markTicks.get(MARKET).observedAtMs,NOW+3);
});
test("M17 advanced signed order expiration, cancel and replay tombstones",()=>{
  let state=withPosition();
  state=step(state,advanced(A,2,"expires","sell","stop_loss_market",
    "0","2","9","8",true,MARKET,NOW+10),NOW+2).state;
  const after=step(state,tick(D,1,"8.5",NOW+11),NOW+11,{tickSigner:D.owner});
  assert.deepEqual(after.result.expiredIds,[A.owner+":expires"]);
  assert.equal(after.state.conditionals.size,0);
  assert.deepEqual(orderTransitions(after.state,A.owner+":expires").map(x=>x.to),
    ["PENDING_TRIGGER","EXPIRED"]);
  assert.throws(()=>step(after.state,advanced(A,3,"expires","sell","limit",
    "11","1"),NOW+12),/Duplicate client order ID/);
});
test("M17 signed command journal survives restart with exact transitions and sandbox operator",async t=>{
  const path=await temporary(t);
  let journal=await SignedOrderJournal.open(path,{tickSigner:D.owner});
  const commands=[
    legacy(B,1,"seed","sell","10","10"),
    legacy(A,1,"open","buy","10","10"),
    advanced(A,2,"stopJournal","sell","stop_loss_market","0","2","9","8",true),
    legacy(C,1,"bidJournal","buy","8.5","2"),
    tick(D,1,"8.9",NOW+5),
  ];
  for(let i=0;i<commands.length;i++){
    const cmd=commands[i],owner=[B,A,A,C,D][i];
    await journal.submit(cmd,owner.sign(cmd),NOW+i+1);
  }
  const history=journal.getOrderTransitions(A.owner+":stopJournal");
  assert.deepEqual(history.map(x=>x.to),["PENDING_TRIGGER","TRIGGERED","SIMULATED_FILLED"]);
  assert.equal(journal.getSimulatedPosition(A.owner,MARKET).quantityE7,"8");
  const saved=journal.getStatus();
  assert.equal(saved.sandboxPriceOperatorConfigured,true);
  assert.equal(saved.canonicalOracleIntegrated,false);
  await journal.close();
  journal=await SignedOrderJournal.open(path,{tickSigner:D.owner});
  assert.deepEqual(journal.getOrderTransitions(A.owner+":stopJournal"),history);
  assert.equal(journal.getStatus().sequence,5);
  assert.equal(journal.getStatus().simulatedFills,saved.simulatedFills);
  assert.equal(journal.getSimulatedPosition(A.owner,MARKET).quantityE7,"8");
  await journal.close();
  await assert.rejects(()=>SignedOrderJournal.open(path),/operator/);
});
test("M17 journal rejects forged signatures and altered hash chain without accepting simulated fills",async t=>{
  const path=await temporary(t);
  const journal=await SignedOrderJournal.open(path,{tickSigner:D.owner});
  const order=advanced(A,1,"signed","buy","limit","8","2");
  await assert.rejects(()=>journal.submit(order,B.sign(order),NOW),/Invalid order-intent signature/);
  assert.equal(journal.getStatus().sequence,0);
  await journal.submit(order,A.sign(order),NOW);
  const attack={...order,priceE7:"9"};
  await assert.rejects(()=>journal.submit(attack,A.sign(order),NOW+1),/Invalid order-intent signature/);
  await journal.close();
  const content=await readFile(path,"utf8");
  await writeFile(path,content.replace('"priceE7":"8"','"priceE7":"9"'));
  await assert.rejects(()=>SignedOrderJournal.open(path,{tickSigner:D.owner}),/hash-chain/);
});
test("M17 read-only HTTP history/position routes never activate trading",async t=>{
  const path=await temporary(t);
  const journal=await SignedOrderJournal.open(path);
  const order=advanced(A,1,"api","buy","limit","8","2");
  await journal.submit(order,A.sign(order),NOW);
  const server=createSandboxServer(journal,{now:()=>NOW+1});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const origin="http://127.0.0.1:"+server.address().port;
  try{
    const health=await (await fetch(origin+"/health")).json();
    assert.equal(health.tradingEnabled,false);
    assert.equal(health.canonicalOracleIntegrated,false);
    const adv=await (await fetch(origin+"/v1/advanced/order?orderId="+encodeURIComponent(A.owner+":api"))).json();
    assert.equal(adv.order.status,"RESTING");
    assert.equal(adv.order.onchain,false);
    const hist=await (await fetch(origin+"/v1/advanced/history?orderId="+encodeURIComponent(A.owner+":api"))).json();
    assert.deepEqual(hist.transitions.map(x=>x.to),["RESTING"]);
    const pos=await (await fetch(origin+"/v1/advanced/position?owner="+A.owner+"&marketId="+MARKET)).json();
    assert.equal(pos.side,"FLAT");
    assert.equal(pos.executionPermitted,false);
    const denied=await fetch(origin+"/v1/commands",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({command:order,signature:A.sign(order)})});
    assert.equal(denied.status,400);
    assert.equal((await fetch(origin+"/v1/settle",{method:"POST"})).status,404);
  }finally{
    server.closeAllConnections();
    await new Promise(r=>server.close(r));
    await journal.close();
  }
});
