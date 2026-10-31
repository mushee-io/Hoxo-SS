import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {emptyBook,projectCommand} from "../matching/core.mjs";
import {settlementPreview} from "../matching/settlement-preview.mjs";
import {readFile} from "node:fs/promises";

const BASE32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",PASS="Test SDF Network ; September 2015";
function stellarAccount(){
  const raw=generateKeyPairSync("ed25519").publicKey.export({format:"der",type:"spki"}).subarray(-32);
  let c=0;for(const b of Buffer.concat([Buffer.from([48]),raw])){c^=b<<8;for(let i=0;i<8;i++)c=c&0x8000?((c<<1)^0x1021)&65535:(c<<1)&65535;}
  const bytes=Buffer.concat([Buffer.from([48]),raw,Buffer.from([c&255,c>>8])]);
  let n=0,bits=0,out="";
  for(const b of bytes){n=(n<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=BASE32[(n>>>bits)&31];n&=(1<<bits)-1;}}
  if(bits)out+=BASE32[(n<<(5-bits))&31];
  return out;
}
const maker=stellarAccount(),taker=stellarAccount();
const place=(owner,nonce,clientOrderId,side,price,quantity)=>({
  type:"place",networkPassphrase:PASS,owner,nonce,clientOrderId,
  marketId:"xlm-usdc-spot",side,priceE7:price,quantityE7:quantity,expiresAtMs:1800000600000
});
async function fill(){
  let state=emptyBook();
  state=projectCommand(state,place(maker,1,"maker1","sell","2","5"),1800000000000).state;
  const result=projectCommand(state,place(taker,1,"taker1","buy","2.1","1.5"),1800000000001);
  return result.result.simulatedFills[0];
}
async function registry(){
 return JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
}
test("M9 sandbox matching fill yields deterministic non-executable DvP proposal",async()=>{
 const f=await fill(),r=await registry();
 assert.equal(f.makerSide,"sell");
 assert.equal(f.takerSide,"buy");
 assert.equal(f.makerLimitE7,"2");
 assert.equal(f.takerLimitE7,"2.1");
 const p=settlementPreview(f,{registry:r});
 assert.equal(p.state,"BLOCKED");
 assert.match(p.reason,/No verified M9/);
 assert.equal(p.executionPermitted,false);
 assert.equal(p.walletAuthorisationsRequired,2);
 assert.equal(p.terms.quote_amount,"3");
 assert.equal(p.terms.base_amount,"1.5");
 assert.equal(p.terms.maker_side,0);
 assert.equal(p.terms.match_id.length,64);
 assert.deepEqual(p,settlementPreview(f,{registry:r}));
});
test("M9 rejects fake, non-spot and fabricated executable M8 fills",async()=>{
 const f=await fill(),r=await registry();
 assert.throws(()=>settlementPreview({...f,settlement:"SETTLED"},{registry:r}),/Invalid M8/);
 assert.throws(()=>settlementPreview({...f,marketId:"xlm-usdc-perp"},{registry:r}),/Invalid M8/);
 assert.throws(()=>settlementPreview({...f,taker:f.maker},{registry:r}),/Invalid M8/);
 assert.throws(()=>settlementPreview({...f,makerLimitE7:"1.8"},{registry:r}),/inconsistent/);
});
test("M9 rejects price bound violation from 7-decimal upward rounding",async()=>{
 const f=await fill(),r=await registry();
 // 1 base atom at a 0.5 price: ceil pays 1 quote atom (=1.0),
 // violating the taker's max of 0.5.
 const small={...f,quantityE7:"0.0000001",priceE7:"0.5",makerLimitE7:"0.5",takerLimitE7:"0.5"};
 const p=settlementPreview(small,{registry:r});
 assert.equal(p.state,"BLOCKED");
 assert.match(p.reason,/rounding/);
 assert.equal(p.terms,null);
});
test("M9 even a hypothetical candidate remains non-executable without real two-wallet authorization",async()=>{
 const f=await fill(),r=await registry();
 const noKeys=settlementPreview(f,{registry:r,tokenPair:{base_token:"fake",quote_token:"fake"},expiryLedger:5489000});
 assert.equal(noKeys.executionPermitted,false);
 assert.equal(noKeys.terms.base_token,null);
});
