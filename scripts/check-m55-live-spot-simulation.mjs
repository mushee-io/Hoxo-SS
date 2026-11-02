#!/usr/bin/env node
/**
 * M55 read-only live Soroban M9 bilateral spot BUY and SELL simulation.
 * The operator's two existing public Testnet wallet addresses suffice;
 * NO secret keys, Freighter prompts, signing, tx submission, or unpause.
 *
 * npm run m55:simulate:testnet
 */
import {rpc} from "@stellar/stellar-sdk";
import {M45_CANDIDATE,probeM45TestnetPreflight} from "../app/m45-spot-preflight.mjs";
import {simulateM45BilateralSpot} from "../app/m45-spot-simulation.mjs";

const server=new rpc.Server(M45_CANDIDATE.rpc);
const proof=await probeM45TestnetPreflight({server,nowMs:Date.now()});
if(proof.contractPaused!==false||proof.readyForSimulation!==true||
   proof.network!=="Stellar Testnet"||proof.verifiedWasm!==true)
  throw Error("M55 Testnet M9 unpaused, funded and verified contract required");
const results=[];
for(const side of ["sell","buy"]){
  const sample=await simulateM45BilateralSpot({
    server,preflight:proof,side,
    xlmAmount:"0.0100000",usdcAmount:"0.0017000"
  });
  if(sample.simulated!==true||sample.broadcast!==false||
     sample.signaturesApplied!==false||
     sample.terms?.maker_side!==(side==="buy"?1:0)||
     sample.terms?.maker!==M45_CANDIDATE.maker||
     sample.terms?.taker!==M45_CANDIDATE.taker||
     !sample.takerAuthXdr||!sample.sourceTxXdr)
    throw Error("M55 unsigned Soroban "+side+" simulation invalid");
  results.push({
    side,
    makerSide:sample.terms.maker_side,
    contract:proof.contract,network:proof.network,
    observedLedger:sample.currentLedger,expiresAtLedger:sample.terms.expires_at_ledger,
    xlmAmountE7:sample.terms.base_amount,
    usdcAmountE7:sample.terms.quote_amount,
    feeStroops:sample.feeStroops,
    verifiedTakerAuthRequired:true,
    verifiedSourceSignatureRequired:true,
    broadcast:false,settlementVerified:false
  });
}
console.log(JSON.stringify({
  milestone:"M55",
  status:"REAL_STELLAR_TESTNET_SOROBAN_SIMULATION_ONLY",
  m9Paused:false,wasmHashVerified:true,
  checkedAt:new Date().toISOString(),
  results,
  walletSigningStillRequired:true,
  verifiedOnChainFills:0,
  transactionsBroadcast:0
},null,2));
