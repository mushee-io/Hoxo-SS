import test from "node:test";
import assert from "node:assert/strict";
import {
  Account,Address,Contract,Keypair,Operation,TransactionBuilder,authorizeInvocation,
  nativeToScVal, xdr
} from "@stellar/stellar-sdk";
import {createM44FreighterBrowserAdapter,getM44FreighterFromWindow} from "../app/m44-freighter-adapter.mjs";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "../app/m43-freighter-auth-guard.mjs";
import {
  M44_XLM_SAC,M44_USDC_SAC,reviewM44SourceEnvelope,verifyM44TakerAuth,
  createM44EnvelopePreparer,verifyM44MakerEnvelope
} from "../app/m44-stellar-xdr-verifier.mjs";

const maker=Keypair.random(),taker=Keypair.random();
const hex32=s=>s.repeat(64);
const currentLedger=5500000;
const expectedTerms={
  match_id:hex32("a"), maker_order_id:hex32("b"), taker_order_id:hex32("c"),
  maker:maker.publicKey(),taker:taker.publicKey(),
  base_token:M44_XLM_SAC, quote_token:M44_USDC_SAC,
  base_amount:"10000000",quote_amount:"20000000",maker_side:0,
  maker_limit_e7:"10000000",taker_limit_e7:"30000000",
  expires_at_ledger:currentLedger+20
};
function typedMatchTerms(terms){
  const ids=new Set(["match_id","maker_order_id","taker_order_id"]);
  const addressKeys=new Set(["maker","taker","base_token","quote_token"]);
  const i128=new Set(["base_amount","quote_amount","maker_limit_e7","taker_limit_e7"]);
  const entries=Object.entries(terms).map(([key,val])=>{
    let v;
    if(ids.has(key))v=xdr.ScVal.scvBytes(Uint8Array.from(val.match(/../g),x=>parseInt(x,16)));
    else if(addressKeys.has(key))v=new Address(val).toScVal();
    else if(i128.has(key))v=nativeToScVal(BigInt(val),{type:"i128"});
    else v=xdr.ScVal.scvU32(val);
    return new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(key),val:v});
  });
  return xdr.ScVal.scvMap(entries);
}
function operation(terms=expectedTerms){
  return new Contract(M9_TESTNET_CONTRACT_ID).call("settle",typedMatchTerms(terms));
}
function sourceEnvelope(terms=expectedTerms){
  return new TransactionBuilder(new Account(maker.publicKey(),"123456"),{
    fee:"500",networkPassphrase:TESTNET_PASSPHRASE
  }).addOperation(operation(terms)).setTimeout(40).build().toXdr();
}
async function signatureFixture(){
  const initialXdr=sourceEnvelope();
  const tx=TransactionBuilder.fromXdr(initialXdr,TESTNET_PASSPHRASE);
  const invoke=tx.operations[0].func.invokeContract;
  const invocation=new xdr.SorobanAuthorizedInvocation({
    function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
    subInvocations:[]
  });
  const signed=await authorizeInvocation({
    signer:taker,validUntilLedgerSeq:currentLedger+30,invocation,
    networkPassphrase:TESTNET_PASSPHRASE,authV2:true
  });
  const cred=signed.credentials.addressV2;
  const unsigned=new xdr.SorobanAuthorizationEntry({
    rootInvocation:signed.rootInvocation,
    credentials:xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address:cred.address,nonce:cred.nonce,
        signatureExpirationLedger:0,signature:xdr.ScVal.scvVec([])
      })
    )
  });
  const sourceTxXdr=TransactionBuilder.cloneFrom(tx,{fee:String(tx.fee)})
    .clearOperations()
    .addOperation(Operation.invokeHostFunction({func:tx.operations[0].func,auth:[unsigned]}))
    .build().toXdr();
  return {
    sourceTxXdr,takerAuthXdr:unsigned.toXdr("base64"),
    signedTakerAuthEntry:signed.toXdr("base64")
  };
}
test("SDK XDR source review pins single exact M9 settle op, 13 terms, amounts and fee",async()=>{
  const {sourceTxXdr}=await signatureFixture();
  const r=reviewM44SourceEnvelope({sourceTxXdr,expectedTerms,currentLedger});
  assert.equal(r.reviewed,true);
  assert.equal(r.broadcast,false);
  assert.equal(r.feeStroops,"500");
  assert.throws(()=>reviewM44SourceEnvelope({
    sourceTxXdr,expectedTerms:{...expectedTerms,quote_amount:"1"},currentLedger
  }),/diverges/);
  assert.throws(()=>reviewM44SourceEnvelope({sourceTxXdr,
    expectedTerms,currentLedger:currentLedger+100}),/deadline/);
  const other=new TransactionBuilder(new Account(maker.publicKey(),"123456"),{
    fee:"500",networkPassphrase:TESTNET_PASSPHRASE
  }).addOperation(operation()).addOperation(operation()).setTimeout(40).build().toXdr();
  assert.throws(()=>reviewM44SourceEnvelope({sourceTxXdr:other,expectedTerms,currentLedger}),/one operation/);
});
test("SDK verifies non-source signed auth nonce, invocation and Ed25519 signature",async()=>{
  const f=await signatureFixture();
  const verified=verifyM44TakerAuth({...f,expectedTerms,currentLedger});
  assert.equal(verified.signatureVerified,true);
  assert.equal(verified.invocationVerified,true);
  assert.equal(verified.signer,taker.publicKey());
  assert.equal(verified.broadcast,false);
  assert.throws(()=>verifyM44TakerAuth({...f,expectedTerms,
    currentLedger:currentLedger+50}),/expiry|deadline/);
  assert.throws(()=>verifyM44TakerAuth({...f,expectedTerms,
    signedTakerAuthEntry:f.takerAuthXdr,currentLedger}),/unsigned|expired|expiry/);
  const otherSource=sourceEnvelope();
  assert.throws(()=>verifyM44TakerAuth({...f,sourceTxXdr:otherSource,expectedTerms,currentLedger}),
    /simulated source envelope|auth entry/);
  const other=await signatureFixture();
  assert.throws(()=>verifyM44TakerAuth({...f,signedTakerAuthEntry:other.signedTakerAuthEntry,
    expectedTerms,currentLedger}),/nonce/);
});
test("SDK attaches only verified taker auth before maker envelope; verifies source Ed25519",async()=>{
  const f=await signatureFixture();
  const prepare=createM44EnvelopePreparer({expectedTerms,currentLedger,takerAuthXdr:f.takerAuthXdr});
  const args={sourceTxXdr:f.sourceTxXdr,signedTakerAuthEntry:f.signedTakerAuthEntry,
    networkPassphrase:TESTNET_PASSPHRASE,contractId:M9_TESTNET_CONTRACT_ID,
    maker:maker.publicKey(),taker:taker.publicKey(),matchId:expectedTerms.match_id};
  await assert.rejects(prepare({...args,contractId:M44_USDC_SAC}),/mismatch/);
  const {preparedTxXdr}=await prepare(args);
  const prepared=TransactionBuilder.fromXdr(preparedTxXdr,TESTNET_PASSPHRASE);
  assert.equal(prepared.operations[0].auth.length,1);
  assert.equal(prepared.signatures.length,0);
  prepared.sign(maker);
  const signedTxXdr=prepared.toXdr();
  const result=verifyM44MakerEnvelope({preparedTxXdr,signedTxXdr,maker:maker.publicKey()});
  assert.equal(result.signatureVerified,true);
  assert.equal(result.broadcast,false);
  assert.equal(result.executionPermitted,false);
  assert.throws(()=>verifyM44MakerEnvelope({
    preparedTxXdr,signedTxXdr:preparedTxXdr,maker:maker.publicKey()
  }),/one maker envelope signature/);
  assert.throws(()=>verifyM44MakerEnvelope({
    preparedTxXdr,signedTxXdr,maker:taker.publicKey()
  }),/source account mismatch/);
});
test("browser Freighter adapter uses real SEP-43 methods and forbids submit",async()=>{
  let current=taker.publicKey();
  const calls=[];
  const api={
    async getAddress(){return {address:current};},
    async getNetwork(){return {network:"TESTNET",networkPassphrase:TESTNET_PASSPHRASE};},
    async signAuthEntry(xdr,opts){calls.push(["auth",opts]);return {signedAuthEntry:xdr+"AA",signerAddress:current};},
    async signTransaction(xdr,opts){calls.push(["tx",opts]);return {signedTxXdr:xdr+"AA",signerAddress:current};}
  };
  const adapter=createM44FreighterBrowserAdapter(api);
  assert.equal((await adapter.getAddress()).address,taker.publicKey());
  await adapter.getNetwork();
  await adapter.signAuthEntry("QUJDREVGR0hJSktM",{address:current,networkPassphrase:TESTNET_PASSPHRASE});
  current=maker.publicKey();
  await adapter.signTransaction("QUJDREVGR0hJSktN",{address:current,networkPassphrase:TESTNET_PASSPHRASE});
  assert.equal(calls[0][1].address,taker.publicKey());
  assert.equal(calls[1][1].submit,false);
  assert.equal(calls[1][1].address,maker.publicKey());
  assert.equal(getM44FreighterFromWindow({freighterApi:api}).signTransaction instanceof Function,true);
});
test("browser adapter rejects wrong network, wrong signer, unexpected fields and seeds",async()=>{
  const api={
    async getAddress(){return {address:taker.publicKey()};},
    async getNetwork(){return {networkPassphrase:TESTNET_PASSPHRASE};},
    async signAuthEntry(){return {signedAuthEntry:"QUJDREVGR0hJSktM",signerAddress:maker.publicKey()};},
    async signTransaction(){return {signedTxXdr:"QUJDREVGR0hJSktM",signerAddress:maker.publicKey()};}
  };
  const adapter=createM44FreighterBrowserAdapter(api);
  await assert.rejects(adapter.signAuthEntry("QUJDREVGR0hJSktM",
    {address:taker.publicKey(),networkPassphrase:TESTNET_PASSPHRASE}),/signer differs/);
  await assert.rejects(adapter.signTransaction("QUJDREVGR0hJSktM",
    {address:taker.publicKey(),networkPassphrase:"Public Global Stellar Network ; September 2015"}),/explicit Testnet/);
  api.getNetwork=async()=>({networkPassphrase:"mainnet"});
  await assert.rejects(adapter.getNetwork(),/Stellar Testnet/);
  api.getAddress=async()=>({address:taker.publicKey(),seed:"SSECRET"});
  await assert.rejects(adapter.getAddress(),/unexpected field/);
  assert.throws(()=>getM44FreighterFromWindow({}),/missing/);
});
