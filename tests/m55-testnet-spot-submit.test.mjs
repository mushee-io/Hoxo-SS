import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createM45SigningLab} from "../app/m45-signing-lab.mjs";
import {M45_CANDIDATE} from "../app/m45-spot-preflight.mjs";
import {M52_SEND_ACK} from "../app/m52-testnet-spot-finality.mjs";
import {M9_TESTNET_CONTRACT_ID,TESTNET_PASSPHRASE} from "../app/m43-freighter-auth-guard.mjs";

const maker=M45_CANDIDATE.maker,taker=M45_CANDIDATE.taker;
const b64=x=>Buffer.from(x).toString("base64");
const unsigned=b64("UNSIGNED_SIMULATED_SOURCE_XDR_TEST_ONLY");
const unsignedAuth=b64("UNSIGNED_SOROBAN_AUTH_TEST_ONLY");
const signedAuth=b64("SIGNED_SOROBAN_AUTH_TEST_ONLY");
const prepared=b64("PREPARED_TX_WITH_SIGNED_AUTH_TEST_ONLY");
const signedTx=b64("SIGNED_MAKER_TRANSACTION_TEST_ONLY");
const NOW=Date.parse("2026-11-02T12:00:00Z");
const txHash="d".repeat(64);
function makeSession({wrongTaker=false,finalResult=null}={}){
  let current=taker,submitted=[],signedRoles=[];
  const terms=Object.freeze({
    maker,taker,base_amount:"100000",quote_amount:"200000",
    maker_side:1,match_id:"a".repeat(64),expires_at_ledger:1020
  });
  const proof=Object.freeze({
    network:"Stellar Testnet",contract:M9_TESTNET_CONTRACT_ID,
    contractPaused:false,verifiedWasm:true,baseAllowed:true,
    quoteAllowed:true,readyForSimulation:true,
    ledger:1000,observedAtMs:NOW,blockers:[],
    wallets:[{address:maker,trustlineAuthorized:true},
      {address:taker,trustlineAuthorized:true}]
  });
  const adapter={
    async getAddress(){return {address:current};},
    async getNetwork(){return {networkPassphrase:TESTNET_PASSPHRASE};},
    async signAuthEntry(xdr,args){
      assert.equal(current,taker);assert.equal(xdr,unsignedAuth);
      assert.equal(args.address,taker);signedRoles.push("taker");
      return {signedAuthEntry:signedAuth,signerAddress:taker};
    },
    async signTransaction(xdr,args){
      assert.equal(current,maker);assert.equal(xdr,prepared);
      assert.equal(args.address,maker);signedRoles.push("maker");
      return {signedTxXdr:signedTx,signerAddress:maker};
    }
  };
  const lab=createM45SigningLab({
    now:()=>NOW,adapter,server:{id:"test-only-mock-transport"},
    probe:async()=>proof,
    simulate:async(_,amounts)=>{
      assert.equal(amounts.side,"buy");
      return {terms,sourceTxXdr:unsigned,takerAuthXdr:unsignedAuth,
        currentLedger:1000,feeStroops:"2000",simulated:true,broadcast:false};
    },
    makeEnvelopePreparer:()=>async()=>({preparedTxXdr:prepared}),
    verifyTaker:()=>({signatureVerified:!wrongTaker,signer:taker}),
    verifyMaker:()=>({signatureVerified:true,transactionBodyVerified:true}),
    submitReviewed:async args=>{
      submitted.push(args);
      if(finalResult instanceof Error)throw finalResult;
      return finalResult??{
        phase:"ONCHAIN_SETTLED_AND_RECONCILED",
        transactionHash:txHash,settledLedger:1005,
        actualOnchainSettlement:true,observedBalancesReconciled:true
      };
    }
  });
  return {lab,proof,terms,submitted,signedRoles,
    useMaker:()=>{current=maker;},useTaker:()=>{current=taker;}};
}
async function signBoth(f){
  await f.lab.prepare({acknowledged:true,side:"buy",xlmAmount:"0.01",usdcAmount:"0.02"});
  assert.equal(f.lab.snapshot().phase,"SIMULATED");
  await f.lab.approveTaker({acknowledged:true});
  assert.equal(f.lab.snapshot().phase,"TAKER_SIGNED");
  f.useMaker();
  await f.lab.approveMaker({acknowledged:true});
  assert.equal(f.lab.snapshot().phase,"SIGNED_NOT_SENT");
  assert.equal(f.lab.snapshot().transactionHash,null);
}
test("M55 only submits exact user-confirmed two-wallet XDR and records on-chain receipt after finality",async()=>{
  const f=makeSession();
  await signBoth(f);
  await assert.rejects(f.lab.submit({acknowledgement:"yes"}),/exact Testnet send confirmation/);
  assert.equal(f.lab.snapshot().phase,"SIGNED_NOT_SENT","mistyped confirmation must not discard signatures");
  assert.equal(f.submitted.length,0);
  const r=await f.lab.submit({acknowledgement:M52_SEND_ACK});
  assert.equal(r.phase,"SETTLED");
  assert.equal(r.transactionHash,txHash);
  assert.equal(r.settledLedger,1005);
  assert.equal(r.verifiedOnChain,true);
  assert.equal(r.confirmedVolumeE7,"100000");
  assert.equal(f.submitted.length,1);
  assert.equal(f.submitted[0].server.id,"test-only-mock-transport");
  assert.equal(f.submitted[0].sourceTxXdr,unsigned);
  assert.equal(f.submitted[0].takerAuthXdr,unsignedAuth);
  assert.equal(f.submitted[0].signedTakerAuthEntry,signedAuth);
  assert.equal(f.submitted[0].preparedTxXdr,prepared);
  assert.equal(f.submitted[0].signedTxXdr,signedTx);
  assert.equal(f.submitted[0].expectedTerms,f.terms);
  assert.equal(f.submitted[0].send,true);
  assert.equal(f.submitted[0].acknowledgement,M52_SEND_ACK);
  assert.deepEqual(f.signedRoles,["taker","maker"]);
  await assert.rejects(f.lab.submit({acknowledgement:M52_SEND_ACK}),/final review/);
  assert.equal(f.lab.snapshot().transactionHash,txHash,"duplicate clicks must preserve verified receipt");
  assert.equal(f.submitted.length,1,"must never submit the same signed match twice");
});
test("M55 refuses to send without both wallet signatures or when final Wallet 1 address is wrong",async()=>{
  const f=makeSession();
  await assert.rejects(f.lab.submit({acknowledgement:M52_SEND_ACK}),/final review/);
  await f.lab.prepare({acknowledged:true,side:"buy"});
  await assert.rejects(f.lab.submit({acknowledgement:M52_SEND_ACK}),/final review/);
  await f.lab.approveTaker({acknowledged:true});
  await assert.rejects(f.lab.submit({acknowledgement:M52_SEND_ACK}),/final review/);
  f.useMaker();await f.lab.approveMaker({acknowledged:true});
  f.useTaker();
  await assert.rejects(f.lab.submit({acknowledgement:M52_SEND_ACK}),/Wallet 1 must be selected/);
  assert.equal(f.submitted.length,0);
  assert.equal(f.lab.snapshot().phase,"IDLE","untrusted account transition clears signed session");
});
test("M55 invalid signed auth or unverified receipt can never report a real Testnet fill",async()=>{
  const invalid=makeSession({wrongTaker:true});
  await invalid.lab.prepare({acknowledged:true,side:"buy"});
  await assert.rejects(invalid.lab.approveTaker({acknowledged:true}),/authorization missing/);
  assert.equal(invalid.submitted.length,0);
  const wrong=makeSession({finalResult:{
    phase:"REVIEWED_ONLY",transactionHash:null,actualOnchainSettlement:false
  }});
  await signBoth(wrong);
  await assert.rejects(wrong.lab.submit({acknowledgement:M52_SEND_ACK}),
    /not independently confirmed/);
  assert.equal(wrong.lab.snapshot().verifiedOnChain,false);
  assert.equal(wrong.submitted.length,1);
  const failed=makeSession({finalResult:new Error("RPC finality unknown")});
  await signBoth(failed);
  await assert.rejects(failed.lab.submit({acknowledgement:M52_SEND_ACK}),/RPC finality unknown/);
  assert.equal(failed.lab.snapshot().verifiedOnChain,false);
  assert.equal(failed.submitted.length,1,"no background retries allowed");
});
test("M55 HTML final submission is independently consented, Testnet only, no normal order ticket bypass",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/m45-spot-ui.mjs",import.meta.url),"utf8");
  const signing=await readFile(new URL("../app/m45-signing-lab.mjs",import.meta.url),"utf8");
  for(const id of ["m55FinalReview","m55SendAck","m55SendPhrase","m55Submit","m55Receipt"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/id="m55Submit"[^>]+disabled/);
  assert.match(html,/id="tradeButton"[^>]+class="trade-review"/);
  assert.match(ui,/submit\(\{acknowledgement/);
  assert.match(ui,/VIEW VERIFIED TESTNET TRANSACTION/);
  assert.match(signing,/m52ReviewedSpotSettlement/);
  assert.match(signing,/phase="SETTLED"/);
  assert.doesNotMatch(ui,/localStorage|sessionStorage|submit:true|set_pause/);
});
