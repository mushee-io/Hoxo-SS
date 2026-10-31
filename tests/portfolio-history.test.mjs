import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TESTNET} from "../assets/testnet-status.mjs";
import {loadStellarWalletActivity,normalizePayment,HORIZON_ACTIVITY_SOURCE}
  from "../portfolio/stellar-history.mjs";
import {projectSandboxHistory} from "../portfolio/sandbox-history.mjs";
import {emptyBook,projectCommand} from "../matching/core.mjs";
import {SignedOrderJournal} from "../matching/journal.mjs";
import {createSandboxServer} from "../matching/http.mjs";
import {canonicalPayload,TESTNET_PASSPHRASE} from "../matching/auth.mjs";
const NOW=Date.parse("2026-10-31T15:00:00Z");
const ABC="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function gAddress(publicKey){
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
    while(bits>=5){bits-=5;result+=ABC[(buffer>>>bits)&31];buffer&=(1<<bits)-1;}
  }
  if(bits)result+=ABC[(buffer<<(5-bits))&31];
  return result;
}
function wallet(){
  const pair=generateKeyPairSync("ed25519");
  return {owner:gAddress(pair.publicKey),
    sign:command=>sign(null,canonicalPayload(command),pair.privateKey).toString("base64url")};
}
const A=wallet(),B=wallet(),C=wallet();
function payment(index,from=A.owner,to=B.owner,overrides={}){
  return {id:String(index),paging_token:String(index),
    transaction_hash:index.toString(16).padStart(64,"a").slice(-64),
    transaction_successful:true,ledger:4_999_999,
    created_at:new Date(NOW-15000).toISOString(),
    type:"payment",from,to,asset_type:"native",amount:"1.5000000",...overrides};
}
function mockNetwork({
  pages=[[]],wrongPassphrase=false,stale=false,wrongAccount=false,
  unfunded=false,badStatus=null,balances=[{asset_type:"native",balance:"25.0000000"}]
}={}){
  const urls=[];
  const fetchImpl=async url=>{
    urls.push(url);
    let data,status=200;
    if(url===TESTNET.horizon+"/"){
      data={network_passphrase:wrongPassphrase?"Mainnet":TESTNET.passphrase,
        history_latest_ledger:5000000,
        history_latest_ledger_closed_at:new Date(NOW-(stale?300000:5000)).toISOString()};
    }else if(url===TESTNET.horizon+"/accounts/"+A.owner){
      if(unfunded){status=404;data={};}
      else data={account_id:wrongAccount?B.owner:A.owner,balances};
    }else if(url.startsWith(TESTNET.horizon+"/accounts/"+A.owner+"/payments?")){
      const parsed=new URL(url);
      const cursor=parsed.searchParams.get("cursor");
      const which=cursor?Number(cursor)/10:0;
      data={_embedded:{records:pages[which]||[]}};
    }else throw Error("Unexpected external URL "+url);
    if(badStatus&&url.includes("/payments?"))status=badStatus;
    return {ok:status===200,status,json:async()=>data};
  };
  return {fetchImpl,urls};
}
function place(actor,nonce,id,side,price,amount,market="xlm-usdc-perp"){
  return {type:"place",networkPassphrase:TESTNET_PASSPHRASE,
    owner:actor.owner,nonce,clientOrderId:id,marketId:market,
    side,priceE7:price,quantityE7:amount,expiresAtMs:NOW+600000};
}
async function tmp(t){
  const dir=await mkdtemp(join(tmpdir(),"hoxo-m18-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return join(dir,"journal.jsonl");
}
test("M18 uses fresh exact Stellar Testnet proof before any public wallet payments",async()=>{
  const m=mockNetwork({pages:[[payment(10)]]});
  const result=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW,limit:25});
  assert.equal(result.funded,true);
  assert.equal(result.observedLedger,5000000);
  assert.equal(result.balances[0].balance,"25.0000000");
  assert.equal(result.payments[0].txHash.length,64);
  assert.equal(result.payments[0].direction,"OUT");
  assert.equal(result.payments[0].provenance,HORIZON_ACTIVITY_SOURCE);
  assert.equal(result.payments[0].hoxoTrade,false);
  assert.equal(result.payments[0].hoxoDeposit,false);
  assert.equal(result.executionPermitted,false);
  assert.deepEqual(m.urls.slice(0,2),[TESTNET.horizon+"/",TESTNET.horizon+"/accounts/"+A.owner]);
});
test("M18 rejects wrong Testnet passphrase and stale Horizon root before payment reads",async()=>{
  for(const options of [{wrongPassphrase:true},{stale:true}]){
    const m=mockNetwork(options);
    await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW}));
    assert.equal(m.urls.length,1);
  }
});
test("M18 does not accept account-switch response under another G-address",async()=>{
  const m=mockNetwork({wrongAccount:true});
  await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW}),/identity mismatch/);
  assert.equal(m.urls.length,2);
});
test("M18 unfunded account has no invented transactions, PnL or margin",async()=>{
  const m=mockNetwork({unfunded:true});
  const r=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW});
  assert.equal(r.funded,false);
  assert.deepEqual(r.payments,[]);
  assert.deepEqual(r.balances,[]);
  assert.equal(r.completeness,"ACCOUNT_UNFUNDED");
  assert.equal(m.urls.length,2);
});
test("M18 inbound, outbound and same-address payments preserve exact amount and issuer",()=>{
  const incoming=normalizePayment(payment(11,B.owner,A.owner),A.owner,5000000,NOW);
  assert.equal(incoming.direction,"IN");
  const self=normalizePayment(payment(12,A.owner,A.owner),A.owner,5000000,NOW);
  assert.equal(self.direction,"SELF");
  const code=normalizePayment(payment(13,A.owner,B.owner,{
    asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:C.owner,amount:"0.0000001"
  }),A.owner,5000000,NOW);
  assert.equal(code.assetId,"USDC:"+C.owner);
  assert.equal(code.amount,"0.0000001");
  assert.equal(code.direction,"OUT");
});
test("M18 rejects fake successful status, wrong account, future ledger and malformed transfer values",()=>{
  for(const override of [
    {transaction_successful:false},{transaction_hash:"not-a-hash"},
    {ledger:5000001},{ledger:-1},{created_at:new Date(NOW+100000).toISOString()},
    {from:B.owner,to:C.owner},{from:"GFAKE"},{amount:"-1"},{amount:"1e3"},
    {amount:"0"},{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:"GFAKE"},
    {type:"path_payment_strict_send"}
  ])assert.throws(()=>normalizePayment(payment(14,A.owner,B.owner,override),A.owner,5000000,NOW));
});
test("M18 rejects forged/duplicate payments and malformed Horizon payloads",async()=>{
  const cases=[{pages:[[payment(10),payment(10)]]},
    {pages:[[{...payment(10),id:"not-numeric"}]]},
    {pages:[[payment(10),payment(11)]]}];
  const a=mockNetwork(cases[0]);
  await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:a.fetchImpl,nowMs:NOW,limit:2}),/Duplicate/);
  const b=mockNetwork(cases[1]);
  await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:b.fetchImpl,nowMs:NOW}),/identity/);
  const c=mockNetwork(cases[2]);
  await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:c.fetchImpl,nowMs:NOW,limit:1}),/exceeds requested bound/);
});
test("M18 rejects path traversal and invalid owner, cursor, limit before contacting Horizon",async()=>{
  const m=mockNetwork();
  for(const [owner,params] of [
    ["http://evil",{}],[A.owner,{cursor:"https://evil"}],
    [A.owner,{cursor:"x../"}],[A.owner,{limit:101}],
    [A.owner,{limit:0}],[A.owner,{cursor:100}],
  ])await assert.rejects(()=>loadStellarWalletActivity(owner,{...params,fetchImpl:m.fetchImpl,nowMs:NOW}));
  assert.equal(m.urls.length,0);
});
test("M18 enforces cursor pagination and does not silently call untrusted next href",async()=>{
  const m=mockNetwork({pages:[[payment(10)],[payment(20)]]});
  const one=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW,limit:1});
  assert.equal(one.nextCursor,"10");
  const two=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW,limit:1,cursor:one.nextCursor});
  assert.equal(two.payments[0].operationId,"20");
  assert.equal(two.nextCursor,"20");
  assert.ok(m.urls.at(-1).includes("cursor=10"));
  assert.ok(m.urls.every(x=>x.startsWith(TESTNET.horizon+"/")));
});
test("M18 Horizon HTTP failures do not turn missing wallet payments into empty confirmed history",async()=>{
  const m=mockNetwork({badStatus:503});
  await assert.rejects(()=>loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW}),/HTTP 503/);
});
test("M18 signed sandbox portfolio never turns local fills into real positions or real PnL",()=>{
  let s=emptyBook();
  s=projectCommand(s,place(B,1,"ask","sell","10","3"),NOW).state;
  s=projectCommand(s,place(A,1,"buy","buy","10","2"),NOW+1).state;
  const p=projectSandboxHistory(s,A.owner);
  assert.equal(p.simulatedPositions.length,1);
  assert.equal(p.simulatedPositions[0].quantityE7,"2");
  assert.equal(p.simulatedPositions[0].unrealizedPnlE7,null);
  assert.equal(p.simulatedFills.items.length,1);
  assert.equal(p.simulatedFills.items[0].settlement,"NOT_SETTLED");
  assert.equal(p.pnl.status,"UNAVAILABLE");
  assert.equal(p.funding.status,"UNAVAILABLE");
  assert.equal(p.interest.status,"UNAVAILABLE");
  assert.equal(p.realTradeHistory.status,"UNAVAILABLE");
  assert.equal(p.tradingEnabled,false);
  assert.equal(p.executionPermitted,false);
});
test("M18 wallet-scoped order history never includes another user's signatures or fills",()=>{
  let s=emptyBook();
  s=projectCommand(s,place(B,1,"ask","sell","10","3"),NOW).state;
  s=projectCommand(s,place(A,1,"bid","buy","10","2"),NOW+1).state;
  const p=projectSandboxHistory(s,C.owner);
  assert.deepEqual(p.simulatedFills.items,[]);
  assert.deepEqual(p.openSandboxOrders,[]);
  assert.deepEqual(p.orderHistory.items,[]);
  assert.deepEqual(p.simulatedPositions,[]);
});
test("M18 pagination rejects oversized and negative history offsets and never creates fake trades",()=>{
  const s=emptyBook();
  for(const options of [{limit:0},{limit:101},{cursor:-1},{cursor:1.1},{cursor:100001}]){
    assert.throws(()=>projectSandboxHistory(s,A.owner,options),/pagination/);
  }
  assert.equal(projectSandboxHistory(s,A.owner).realTradeHistory.amountE7,null);
});
test("M18 signed hash-chained journal replays scoped order history and rejects alteration",async t=>{
  const file=await tmp(t);
  let journal=await SignedOrderJournal.open(file);
  const a=place(A,1,"buy","buy","10","2");
  const b=place(B,1,"ask","sell","10","3");
  await journal.submit(b,B.sign(b),NOW);
  await journal.submit(a,A.sign(a),NOW+1);
  const before=journal.getPortfolioHistory(A.owner);
  assert.equal(before.simulatedFills.items.length,1);
  const hash=journal.lastHash;
  await journal.close();
  journal=await SignedOrderJournal.open(file);
  assert.deepEqual(journal.getPortfolioHistory(A.owner),before);
  assert.equal(journal.lastHash,hash);
  await journal.close();
  const original=await readFile(file,"utf8");
  await writeFile(file,original.replace('"quantityE7":"2"','"quantityE7":"3"'));
  await assert.rejects(()=>SignedOrderJournal.open(file),/hash-chain/);
});
test("M18 HTTP exposes distinct public Horizon wallet transfers and sandbox order provenance",async t=>{
  const file=await tmp(t);
  const journal=await SignedOrderJournal.open(file);
  const cmd=place(A,1,"ask","sell","10","2");
  await journal.submit(cmd,A.sign(cmd),NOW);
  const m=mockNetwork({pages:[[payment(22,A.owner,B.owner)]]});
  const server=createSandboxServer(journal,{now:()=>NOW+1,fetchImpl:m.fetchImpl});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url="http://127.0.0.1:"+server.address().port;
  try{
    const portfolio=await (await fetch(url+"/v1/portfolio/sandbox?owner="+A.owner)).json();
    assert.equal(portfolio.openSandboxOrders.length,1);
    assert.equal(portfolio.positions.status,"UNAVAILABLE");
    assert.equal(portfolio.realTradeHistory.status,"UNAVAILABLE");
    const wallet=await (await fetch(url+"/v1/portfolio/wallet?owner="+A.owner)).json();
    assert.equal(wallet.payments[0].provenance,HORIZON_ACTIVITY_SOURCE);
    assert.equal(wallet.hoxoPositions,"UNAVAILABLE_CONTRACT_NOT_DEPLOYED");
    assert.equal(wallet.hoxoTrades,"UNAVAILABLE_NO_HOXO_SETTLEMENT_RECEIPTS");
    assert.equal(wallet.executionPermitted,false);
    const wrong=await fetch(url+"/v1/portfolio/wallet?owner=../../other");
    assert.equal(wrong.status,400);
    assert.equal((await fetch(url+"/v1/portfolio/execute",{method:"POST"})).status,404);
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await journal.close();
  }
});


test("M18 follows official Horizon payment object where operation ledger is absent",async()=>{
  const actual=payment(300);
  delete actual.ledger;
  const m=mockNetwork({pages:[[actual]]});
  const data=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW});
  assert.equal(data.payments.length,1);
  assert.equal(data.payments[0].ledger,null);
  assert.equal(data.observedLedger,5000000);
  assert.equal(data.payments[0].txHash.length,64);
  assert.equal(data.executionPermitted,false);
});
test("M18 account creation is recognized as a native transfer, not a Hoxo deposit",()=>{
  const creation=payment(301,B.owner,A.owner,{
    type:"create_account",funder:B.owner,account:A.owner,starting_balance:"5.0000000"
  });
  delete creation.ledger;
  const normalized=normalizePayment(creation,A.owner,5000000,NOW);
  assert.equal(normalized.type,"ACCOUNT_CREATION");
  assert.equal(normalized.direction,"IN");
  assert.equal(normalized.amount,"5.0000000");
  assert.equal(normalized.code,"XLM");
  assert.equal(normalized.hoxoDeposit,false);
  assert.equal(normalized.ledger,null);
});
test("M18 complex path-payment operations are explicitly excluded, not counted as transfers",async()=>{
  const path=payment(200,B.owner,A.owner,{type:"path_payment_strict_receive"});
  delete path.ledger;
  const simple=payment(199,B.owner,A.owner);
  delete simple.ledger;
  const m=mockNetwork({pages:[[path,simple]]});
  const data=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW,limit:2});
  assert.equal(data.payments.length,1);
  assert.deepEqual(data.excludedOperationTypes,["path_payment_strict_receive"]);
  assert.equal(data.nextCursor,"199");
  assert.equal(data.payments[0].operationId,"199");
});
test("M18 unsupported payment-like page still advances cursor without inventing a transfer",async()=>{
  const ignored=payment(200,B.owner,A.owner,{type:"account_merge"});
  const m=mockNetwork({pages:[[ignored]]});
  const data=await loadStellarWalletActivity(A.owner,{fetchImpl:m.fetchImpl,nowMs:NOW,limit:1});
  assert.deepEqual(data.payments,[]);
  assert.deepEqual(data.excludedOperationTypes,["account_merge"]);
  assert.equal(data.nextCursor,"200");
});
