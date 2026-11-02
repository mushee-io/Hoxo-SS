/**
 * M52 — small, explicitly user-authorized Stellar TESTNET M9 spot send gate.
 *
 * Standalone reviewed engine; NOT connected to Hoxo public trading UI.
 * No wallet keys. Only accepts cryptographically verified Freighter two-party
 * signatures on the identical simulated M9 settle invocation.
 * Does not unpause M9. No automatic submission, no mainnet fallback.
 */
import {TransactionBuilder} from "@stellar/stellar-sdk";
import {M45_CANDIDATE,checkM45TestnetPreflight} from "./m45-spot-preflight.mjs";
import {M9_TESTNET_CONTRACT_ID,TESTNET_PASSPHRASE} from "./m43-freighter-auth-guard.mjs";
import {reviewM44SourceEnvelope,verifyM44TakerAuth,verifyM44MakerEnvelope,
  M44_XLM_SAC,M44_USDC_SAC} from "./m44-stellar-xdr-verifier.mjs";

export const M52_SEND_ACK="SEND_SMALL_HOXO_STELLAR_TESTNET_SPOT";
const CAP_XLM_E7=1_000_000n; // small internal test ceiling: 0.1 XLM
const CAP_USDC_E7=10_000_000n; // 1 test USDC
const MAX_FEE_STROOPS=1_000_000n;
function fail(message){throw Error("M52 Testnet spot: "+message);}
function numberText(s,name){
  if(typeof s!=="string"||!/^[1-9]\d*$/.test(s))fail("invalid "+name);
  return BigInt(s);
}
function sameReceiptId(id,expected){
  if(typeof id==="string"&&/^[a-f0-9]{64}$/i.test(id))return id.toLowerCase()===expected;
  if(id instanceof Uint8Array&&id.length===32)
    return Array.from(id,b=>b.toString(16).padStart(2,"0")).join("")===expected;
  return false;
}
function receiptMatches(receipt,terms){
  if(!receipt||!sameReceiptId(receipt.match_id,terms.match_id)||
     !sameReceiptId(receipt.maker_order_id,terms.maker_order_id)||
     !sameReceiptId(receipt.taker_order_id,terms.taker_order_id)||
     receipt.maker!==terms.maker||receipt.taker!==terms.taker||
     receipt.base_token!==M44_XLM_SAC||receipt.quote_token!==M44_USDC_SAC||
     String(receipt.base_amount)!==terms.base_amount||
     String(receipt.quote_amount)!==terms.quote_amount||
     Number(receipt.maker_side)!==terms.maker_side||
     !Number.isSafeInteger(Number(receipt.settled_ledger))||
     Number(receipt.settled_ledger)<=0)
    fail("on-chain M9 receipt did not match exact signed settlement");
  return Number(receipt.settled_ledger);
}
async function read(server,contract,method,args){
  const reply=await server.queryContract(contract,method,args);
  if(reply?.isReadCall!==true)fail("independent read-only "+method+" proof missing");
  return reply.result;
}
async function tokenState(server,terms){
  const accounts=[terms.maker,terms.taker];
  const result={};
  for(const contract of [M44_XLM_SAC,M44_USDC_SAC]){
    const balances=await Promise.all(accounts.map(id=>read(server,contract,"balance",{id})));
    if(balances.some(n=>typeof n!=="bigint"||n<0n))
      fail("invalid wallet token balance from Soroban read");
    result[contract]=balances;
  }
  return result;
}
function reconcile(before,after,terms,feeCeiling){
  const base=numberText(terms.base_amount,"XLM size");
  const quote=numberText(terms.quote_amount,"USDC size");
  const makerSells=terms.maker_side===0;
  // maker is source (pays network fee). USDC token changes must be exact.
  const expectedXlm=makerSells?[-base,base]:[base,-base];
  const expectedUsdc=makerSells?[quote,-quote]:[-quote,quote];
  const xlmBefore=before[M44_XLM_SAC],xlmAfter=after[M44_XLM_SAC];
  const usdcBefore=before[M44_USDC_SAC],usdcAfter=after[M44_USDC_SAC];
  if(!xlmBefore||!xlmAfter||!usdcBefore||!usdcAfter)fail("missing before/after balances");
  for(let i=0;i<2;i++){
    const usdcDelta=usdcAfter[i]-usdcBefore[i];
    if(usdcDelta!==expectedUsdc[i])
      fail("USDC account balance reconciliation mismatch");
    const xlmDelta=xlmAfter[i]-xlmBefore[i];
    if(i===0){
      const networkFee=expectedXlm[i]-xlmDelta;
      if(networkFee<0n||networkFee>feeCeiling)
        fail("maker XLM balance/fee reconciliation mismatch");
    }else if(xlmDelta!==expectedXlm[i])
      fail("taker XLM balance reconciliation mismatch");
  }
  return true;
}
/**
 * Execute only on separate explicit operator call after safety approval.
 * If send:false, verifies XDR + live chain state and produces REVIEWED_ONLY.
 * This module is never invoked on page load or by the ordinary Buy/Sell UI.
 */
export async function m52ReviewedSpotSettlement({
  server,fetchImpl=fetch,nowMs=Date.now(),sourceTxXdr,takerAuthXdr,
  signedTakerAuthEntry,preparedTxXdr,signedTxXdr,expectedTerms,
  send=false,acknowledgement=""
}={}){
  if(!server||["getNetwork","getLatestLedger","getContractInstance",
    "getContractWasmByContractId","queryContract","sendTransaction","pollTransaction"]
    .some(fn=>typeof server[fn]!=="function"))
    fail("full official Stellar Testnet RPC required");
  const proof=await checkM45TestnetPreflight({server,fetchImpl,nowMs});
  if(proof.network!=="Stellar Testnet"||proof.contract!==M9_TESTNET_CONTRACT_ID||
     proof.contractPaused!==false||proof.readyForSimulation!==true||
     proof.verifiedWasm!==true)
    fail("M9 still paused or canonical Testnet signing preflight blocked");
  if(expectedTerms?.maker!==M45_CANDIDATE.maker||
     expectedTerms?.taker!==M45_CANDIDATE.taker||
     expectedTerms?.base_token!==M44_XLM_SAC||
     expectedTerms?.quote_token!==M44_USDC_SAC)
    fail("unsigned M9 terms are not the exact approved wallets/assets");
  if(numberText(expectedTerms.base_amount,"XLM amount")>CAP_XLM_E7||
     numberText(expectedTerms.quote_amount,"USDC amount")>CAP_USDC_E7)
    fail("initial Testnet trading limits exceeded");
  reviewM44SourceEnvelope({sourceTxXdr,expectedTerms,
    currentLedger:proof.ledger,maxFeeStroops:MAX_FEE_STROOPS});
  const taker=verifyM44TakerAuth({
    sourceTxXdr,takerAuthXdr,signedTakerAuthEntry,
    expectedTerms,currentLedger:proof.ledger,maxFeeStroops:MAX_FEE_STROOPS
  });
  const maker=verifyM44MakerEnvelope({
    preparedTxXdr,signedTxXdr,maker:expectedTerms.maker
  });
  if(!taker.signatureVerified||taker.signer!==expectedTerms.taker||
     !maker.signatureVerified||!maker.transactionBodyVerified)
    fail("both exact independently verified wallet signatures required");
  const tx=TransactionBuilder.fromXdr(signedTxXdr,TESTNET_PASSPHRASE);
  if(tx.source!==expectedTerms.maker||tx.operations.length!==1||
     BigInt(tx.fee)>MAX_FEE_STROOPS||
     !Number.isSafeInteger(proof.ledger)||
     expectedTerms.expires_at_ledger<proof.ledger)
    fail("signed envelope stale, altered or exceeds fee ceiling");
  // Never sign or unpause automatically, and don't silently infer consent.
  if(send!==true)return Object.freeze({
    phase:"REVIEWED_ONLY",signaturesVerified:true,transactionHash:null,
    broadcast:false,settlementConfirmed:false,executionPermitted:false
  });
  if(acknowledgement!==M52_SEND_ACK)
    fail("separate explicit Testnet send acknowledgement required");
  const settledBefore=await read(server,M9_TESTNET_CONTRACT_ID,"is_settled",{
    match_id:Uint8Array.from(expectedTerms.match_id.match(/../g),x=>parseInt(x,16))
  });
  if(settledBefore!==false)fail("settlement replay or ambiguous chain state");
  // Require another current-ledger proof just before submit.
  const fresh=await server.getLatestLedger();
  const height=Number(fresh?.sequence);
  if(!Number.isSafeInteger(height)||height<proof.ledger||
     height>expectedTerms.expires_at_ledger)
    fail("M9 signed settlement expired before broadcast");
  if(await read(server,M9_TESTNET_CONTRACT_ID,"paused")!==false)
    fail("M9 became paused before broadcast");
  const before=await tokenState(server,expectedTerms);
  const sent=await server.sendTransaction(tx);
  const hash=sent?.hash;
  if(typeof hash!=="string"||!/^[0-9a-f]{64}$/i.test(hash)||
     !["PENDING","DUPLICATE"].includes(sent?.status))
    fail("RPC did not accept the exact signed Testnet transaction");
  const final=await server.pollTransaction(hash);
  if(final?.status!=="SUCCESS"||final?.hash?.toLowerCase()!==hash.toLowerCase())
    fail("transaction broadcast but confirmed success is missing; inspect hash "+hash);
  const matchId=Uint8Array.from(expectedTerms.match_id.match(/../g),x=>parseInt(x,16));
  const receipt=await read(server,M9_TESTNET_CONTRACT_ID,"receipt",{match_id:matchId});
  const confirmedLedger=receiptMatches(receipt,expectedTerms);
  if(await read(server,M9_TESTNET_CONTRACT_ID,"is_settled",{match_id:matchId})!==true)
    fail("transaction submitted, but M9 replay marker is not confirmed");
  const after=await tokenState(server,expectedTerms);
  reconcile(before,after,expectedTerms,MAX_FEE_STROOPS);
  return Object.freeze({
    phase:"ONCHAIN_SETTLED_AND_RECONCILED",
    transactionHash:hash.toLowerCase(),settledLedger:confirmedLedger,
    network:"Stellar Testnet",matchId:expectedTerms.match_id,
    observedBalancesReconciled:true,
    actualOnchainSettlement:true,publicBetaAuthorized:false
  });
}
