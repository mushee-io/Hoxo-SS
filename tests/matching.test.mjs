import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { canonicalPayload, verifySignedCommand, TESTNET_PASSPHRASE } from "../matching/auth.mjs";
import { emptyBook, projectCommand, snapshot, orderById, decimalUnits, formatUnits } from "../matching/core.mjs";
import { SignedOrderJournal } from "../matching/journal.mjs";
import { createSandboxServer } from "../matching/http.mjs";

const NOW = 1_800_000_000_000;
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encodeG(publicKey) {
  const raw = publicKey.export({format:"der",type:"spki"}).subarray(-32);
  const bytes = Buffer.concat([Buffer.from([48]),raw]);
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for(let i=0;i<8;i++) crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  const all=Buffer.concat([bytes,Buffer.from([crc&255,crc>>8])]);
  let buffer=0,bits=0,result="";
  for(const value of all) {
    buffer=(buffer<<8)|value;bits+=8;
    while(bits>=5){bits-=5;result+=ALPHA[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}
  }
  if(bits>0)result+=ALPHA[(buffer<<(5-bits))&31];
  return result;
}
function wallet(){
  const pair=generateKeyPairSync("ed25519");
  const owner=encodeG(pair.publicKey);
  return {
    owner,
    sign(command) {return sign(null,canonicalPayload(command),pair.privateKey).toString("base64url");},
  };
}
const A=wallet(),B=wallet(),C=wallet();
function place(actor,nonce,id,side,price,qty,marketId="xlm-usdc-spot",expiry=NOW+600000) {
  return {type:"place",networkPassphrase:TESTNET_PASSPHRASE,owner:actor.owner,nonce,
    clientOrderId:id,marketId,side,priceE7:price,quantityE7:qty,expiresAtMs:expiry};
}
function cancel(actor,nonce,orderId) {
  return {type:"cancel",networkPassphrase:TESTNET_PASSPHRASE,owner:actor.owner,nonce,orderId};
}
function replace(actor,nonce,orderId,id,side,price,qty,marketId="xlm-usdc-spot") {
  return {type:"replace",networkPassphrase:TESTNET_PASSPHRASE,owner:actor.owner,nonce,
    orderId,clientOrderId:id,marketId,side,priceE7:price,quantityE7:qty,expiresAtMs:NOW+600000};
}
const advance=(state,command,at=NOW)=>projectCommand(state,command,at);
async function temporary(t){
  const dir=await mkdtemp(join(tmpdir(),"hoxo-m8-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return join(dir,"testnet-m8.jsonl");
}

test("M8 integer fixed-point orders reject invalid quantities without floating point",()=>{
  assert.equal(decimalUnits("12.3456789"),123456789n);
  assert.equal(formatUnits(123456789n),"12.3456789");
  for(const invalid of ["0","-1","1e3","1.12345678","0001","Infinity","0.0000000"," 5"]){
    assert.throws(()=>decimalUnits(invalid),undefined,invalid);
  }
});
test("M8 signed Stellar Ed25519 commands have network/domain separation",()=>{
  const cmd=place(A,1,"order1","buy","1.5","2");
  assert.equal(A.owner.length,56);
  assert.equal(verifySignedCommand(cmd,A.sign(cmd)),true);
  assert.throws(()=>verifySignedCommand(cmd,B.sign(cmd)),/Invalid order-intent signature/);
  assert.throws(()=>canonicalPayload({...cmd,networkPassphrase:"Public Global Stellar Network ; September 2015"}),/Wrong Stellar network/);
  assert.throws(()=>canonicalPayload({...cmd,malicious:true}),/missing or unexpected/);
  assert.throws(()=>verifySignedCommand(cmd,"not a signature"),/Signature must be/);
});
test("M8 best-price matching respects maker price, even when older maker is worse",()=>{
  let book=emptyBook();
  book=advance(book,place(A,1,"ask9","sell","9","1")).state;
  book=advance(book,place(B,1,"ask8","sell","8","1")).state;
  const step=advance(book,place(C,1,"bid10","buy","10","1"));
  assert.equal(step.result.simulatedFills.length,1);
  assert.equal(step.result.simulatedFills[0].priceE7,"8");
  assert.equal(step.result.simulatedFills[0].makerOrderId,B.owner+":ask8");
  assert.equal(step.result.simulatedFills[0].settlement,"NOT_SETTLED");
  assert.equal(step.result.executionPermitted,false);
  assert.equal(step.state.orders.size,1);
});
test("M8 FIFO at the same price and partial fills have deterministic quantity",()=>{
  let s=emptyBook();
  s=advance(s,place(A,1,"a1","sell","5","2")).state;
  s=advance(s,place(B,1,"b1","sell","5","1")).state;
  const result=advance(s,place(C,1,"c1","buy","7","2.5"));
  assert.deepEqual(result.result.simulatedFills.map(f=>[f.makerOrderId,f.quantityE7]),
    [[A.owner+":a1","2"],[B.owner+":b1","0.5"]]);
  assert.equal(orderById(result.state,B.owner+":b1").remainingE7,"0.5");
  assert.equal(orderById(s,B.owner+":b1").remainingE7,"1","Original state must not mutate");
  assert.equal(snapshot(result.state,"xlm-usdc-spot").asks.length,1);
});
test("M8 passive orders display price/time sorting, not price of last testnet trade",()=>{
  let s=emptyBook();
  s=advance(s,place(A,1,"ask11","sell","11","1")).state;
  s=advance(s,place(B,1,"ask10","sell","10","1")).state;
  s=advance(s,place(C,1,"bid9","buy","9","1")).state;
  const view=snapshot(s,"xlm-usdc-spot");
  assert.deepEqual(view.asks.map(x=>x.priceE7),["10","11"]);
  assert.deepEqual(view.bids.map(x=>x.priceE7),["9"]);
  assert.equal(view.settleable,false);
  assert.match(view.provenance,/SANDBOX ONLY/);
});
test("M8 self trade prevention fails entire order, including prior third-party fills",()=>{
  let s=emptyBook();
  s=advance(s,place(B,1,"ask8","sell","8","1")).state;
  s=advance(s,place(A,1,"ask9","sell","9","1")).state;
  assert.throws(()=>advance(s,place(A,2,"bid10","buy","10","2")),/Self-trade prevention/);
  assert.equal(s.sequence,2);
  assert.equal(s.fills.length,0);
  assert.equal(s.orders.size,2);
});
test("M8 cancellations are owner-authenticated and nonces never replay",()=>{
  let s=emptyBook();
  s=advance(s,place(A,1,"sell1","sell","11","1")).state;
  assert.throws(()=>advance(s,cancel(B,1,A.owner+":sell1")),/ownership mismatch/);
  s=advance(s,cancel(A,2,A.owner+":sell1")).state;
  assert.equal(s.orders.size,0);
  assert.throws(()=>advance(s,cancel(A,2,A.owner+":sell1")),/Replayed/);
  assert.throws(()=>advance(s,place(A,3,"sell1","sell","11","1")),/Duplicate client/);
});
test("M8 atomic replace loses queue priority and leaves old order on invalid replace",()=>{
  let s=emptyBook();
  s=advance(s,place(A,1,"a","sell","9","2")).state;
  s=advance(s,place(B,1,"b","sell","9","2")).state;
  const bad=replace(A,2,A.owner+":a","a2","sell","-1","2");
  assert.throws(()=>advance(s,bad),/positive fixed-point/);
  assert.equal(s.orders.size,2);
  s=advance(s,replace(A,2,A.owner+":a","a2","sell","9","2")).state;
  const asks=snapshot(s,"xlm-usdc-spot").asks;
  assert.deepEqual(asks.map(x=>x.id),[B.owner+":b",A.owner+":a2"]);
  assert.equal(s.orders.has(A.owner+":a"),false);
});
test("M8 order expiration runs at recorded command timestamp, replayable",()=>{
  let s=emptyBook();
  s=advance(s,place(A,1,"short","sell","9","1","xlm-usdc-spot",NOW+1000)).state;
  const next=advance(s,place(B,1,"buy","buy","8","1"),NOW+2000);
  assert.deepEqual(next.result.expiredIds,[A.owner+":short"]);
  assert.equal(next.state.orders.size,1);
});
test("M8 rejects market orders, invalid expiration and unapproved catalog symbols",()=>{
  let cmd=place(A,1,"a","buy","1","1");
  assert.throws(()=>advance(emptyBook(),{...cmd,marketId:"mainnet-usdc"}),/reference catalog/);
  assert.throws(()=>advance(emptyBook(),{...cmd,expiresAtMs:NOW-1}),/expiry/);
  assert.throws(()=>advance(emptyBook(),{...cmd,priceE7:"0"}),/positive fixed-point/);
  assert.throws(()=>advance(emptyBook(),{...cmd,side:"market"}),/order side/);
});
test("M8 durable journal replays identical book and simulated fills across restart",async t=>{
  const file=await temporary(t);
  const journal=await SignedOrderJournal.open(file);
  const first=place(A,1,"ask","sell","5","2");
  const second=place(B,1,"bid","buy","6","1");
  const a=await journal.submit(first,A.sign(first),NOW);
  const b=await journal.submit(second,B.sign(second),NOW+1);
  assert.equal(b.simulatedFills.length,1);
  assert.equal(a.sequence,1);
  const expected=journal.getBook("xlm-usdc-spot");
  const fills=journal.getFills("xlm-usdc-spot");
  await journal.close();
  const restored=await SignedOrderJournal.open(file);
  assert.deepEqual(restored.getBook("xlm-usdc-spot"),expected);
  assert.deepEqual(restored.getFills("xlm-usdc-spot"),fills);
  assert.equal(restored.getStatus().settlement,"DISABLED");
  assert.equal(restored.getStatus().sequence,2);
  await restored.close();
});
test("M8 log corruption, incomplete tail and concurrent writer lock fail closed",async t=>{
  const file=await temporary(t);
  const journal=await SignedOrderJournal.open(file);
  await assert.rejects(()=>SignedOrderJournal.open(file),/EEXIST/);
  const cmd=place(A,1,"a","sell","1","1");
  await journal.submit(cmd,A.sign(cmd),NOW);
  await journal.close();
  const original=await readFile(file,"utf8");
  await writeFile(file,original.trimEnd());
  await assert.rejects(()=>SignedOrderJournal.open(file),/incomplete final line/);
  await writeFile(file,original.replace('"priceE7":"1"','"priceE7":"2"'));
  await assert.rejects(()=>SignedOrderJournal.open(file),/hash-chain/);
});
test("M8 invalid signatures never enter journal or consume owner nonce",async t=>{
  const file=await temporary(t);
  const journal=await SignedOrderJournal.open(file);
  const cmd=place(A,1,"a","buy","1","1");
  await assert.rejects(()=>journal.submit(cmd,B.sign(cmd),NOW),/Invalid order-intent signature/);
  assert.equal(journal.getStatus().sequence,0);
  assert.equal((await journal.submit(cmd,A.sign(cmd),NOW)).sequence,1);
  await journal.close();
});
test("M8 serialized concurrent signed writes preserve sequence and replay",async t=>{
  const file=await temporary(t);
  const journal=await SignedOrderJournal.open(file);
  const a=place(A,1,"one","buy","1","1");
  const b=place(A,2,"two","buy","1","1");
  const result=await Promise.all([journal.submit(a,A.sign(a),NOW),journal.submit(b,A.sign(b),NOW)]);
  assert.deepEqual(result.map(x=>x.sequence),[1,2]);
  await journal.close();
  const reopened=await SignedOrderJournal.open(file);
  assert.equal(reopened.getStatus().sequence,2);
  await reopened.close();
});
test("M8 HTTP API is loopback-ready but has no trade/settlement endpoint",{timeout:20000},async t=>{
  const file=await temporary(t);
  const journal=await SignedOrderJournal.open(file);
  const server=createSandboxServer(journal,{now:()=>NOW});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(r=>server.close(r));
    await journal.close();
  });
  const base="http://127.0.0.1:"+server.address().port;
  const health=await (await fetch(base+"/health")).json();
  assert.equal(health.tradingEnabled,false);
  assert.equal(health.onchainOrders,false);
  assert.equal(health.settlement,"DISABLED");
  const cmd=place(A,1,"ask","sell","9","1");
  const signed={command:cmd,signature:A.sign(cmd)};
  const withoutAck=await fetch(base+"/v1/commands",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(signed)});
  assert.equal(withoutAck.status,400);
  const withOrigin=await fetch(base+"/v1/commands",{method:"POST",headers:{"content-type":"application/json","x-hoxo-sandbox-ack":"UNSETTLED",origin:"https://example.com"},body:JSON.stringify(signed)});
  assert.equal(withOrigin.status,400);
  const placed=await fetch(base+"/v1/commands",{method:"POST",headers:{"content-type":"application/json","x-hoxo-sandbox-ack":"UNSETTLED"},body:JSON.stringify(signed)});
  assert.equal(placed.status,201);
  const payload=await placed.json();
  assert.equal(payload.executionPermitted,false);
  const book=await (await fetch(base+"/v1/book?marketId=xlm-usdc-spot")).json();
  assert.equal(book.asks.length,1);
  assert.equal(book.tradingEnabled,false);
  const fills=await (await fetch(base+"/v1/fills?marketId=xlm-usdc-spot")).json();
  assert.equal(fills.settlement,"NOT_SETTLED");
  assert.equal((await fetch(base+"/v1/settle",{method:"POST"})).status,404);
});
