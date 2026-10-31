import test from "node:test";
import assert from "node:assert/strict";
import {Keypair,Account,TransactionBuilder,Operation,Networks} from "@stellar/stellar-sdk";
import * as stellar from "@stellar/stellar-sdk";
import {inspectM21Envelope} from "../verification/m21.mjs";

test("M21 verifies actual signed Testnet XDR transaction hash, wallet and exact Soroban call",()=>{
  const maker=Keypair.random(),other=Keypair.random();
  const contractId="C"+""; // overwritten with canonical StrKey from SDK address
  const contract=stellar.StrKey.encodeContract(Buffer.alloc(32,7));
  const build=(key,method="deposit",contractTarget=contract)=>{
    const tx=new TransactionBuilder(new Account(key.publicKey(),"1"),{
      fee:"100",networkPassphrase:Networks.TESTNET})
      .addOperation(Operation.invokeContractFunction({
        contract:contractTarget,function:method,args:[],
      })).setTimeout(120).build();
    tx.sign(key);
    return tx;
  };
  const tx=build(maker);
  const params={
    envelopeXdr:tx.toXDR(),transactionHash:tx.hash().toString("hex"),
    expectedSigner:maker.publicKey(),contractId:contract,method:"deposit"
  };
  const good=inspectM21Envelope(stellar,params);
  assert.equal(good.envelopeHashVerified,true);
  assert.equal(good.sourceWalletSignatureVerified,true);
  assert.equal(good.invocationTargetVerified,true);
  assert.equal(good.financialStateVerified,false);
  assert.throws(()=>inspectM21Envelope(stellar,{...params,
    transactionHash:"0".repeat(64)}),/hash/);
  assert.throws(()=>inspectM21Envelope(stellar,{...params,
    expectedSigner:other.publicKey()}),/wallet/);
  assert.throws(()=>inspectM21Envelope(stellar,{...params,
    method:"withdraw"}),/wrong contract role or method/);
  const wrong=build(other,"deposit");
  assert.throws(()=>inspectM21Envelope(stellar,{...params,envelopeXdr:wrong.toXDR()}),/hash/);
  const mainnetTx=new TransactionBuilder(new Account(maker.publicKey(),"1"),{
    fee:"100",networkPassphrase:Networks.PUBLIC})
    .addOperation(Operation.invokeContractFunction({
      contract,function:"deposit",args:[],
    })).setTimeout(120).build();
  mainnetTx.sign(maker);
  assert.throws(()=>inspectM21Envelope(stellar,{...params,
    envelopeXdr:mainnetTx.toXDR()}),/hash/);
});
