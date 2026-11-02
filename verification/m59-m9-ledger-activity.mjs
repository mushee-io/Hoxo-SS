/**
 * M59: independent, read-only Stellar TESTNET M9 SpotSettled ledger evidence.
 * Never invent Hoxo fills or volume: each row must come from the exact M9
 * event plus a successful matching transaction. No wallet/secrets/signing.
 *
 * Intentionally a bounded RECENT WINDOW, not "all time" or "24h" TVL/volume.
 */
import {rpc,scValToNative} from "@stellar/stellar-sdk";
import {M9_TESTNET_CONTRACT_ID,TESTNET_PASSPHRASE}
  from "../app/m43-freighter-auth-guard.mjs";
import {M44_XLM_SAC,M44_USDC_SAC}
  from "../app/m44-stellar-xdr-verifier.mjs";

const HASH=/^[a-f0-9]{64}$/i, G=/^G[A-Z2-7]{55}$/;
const MAX_EVENTS=100,SCAN_LEDGERS=3000;
function fail(message){throw Error("M59 M9 ledger feed: "+message);}
function asStr(v){if(typeof v!=="string")fail("invalid native string");return v;}
function asInt(v){if(typeof v==="bigint")return v;
 if(typeof v==="string"&&/^(0|[1-9]\d*)$/.test(v))return BigInt(v);
 fail("invalid exact Soroban i128");
}
function hex32(v){
  if(!(v instanceof Uint8Array)||v.length!==32)fail("invalid match ID");
  return Array.from(v,b=>b.toString(16).padStart(2,"0")).join("");
}
function native(v){return scValToNative(v);}
function contractAddress(v){
  if(typeof v==="string")return v;
  if(v&&typeof v.contractId==="function")return v.contractId();
  fail("event contract identity unknown");
}
export function normalizeM59SpotEvent(event){
  if(!event||event.type!=="contract"||
     contractAddress(event.contractId)!==M9_TESTNET_CONTRACT_ID)
    fail("unrelated contract event");
  if(!Array.isArray(event.topic)||event.topic.length!==3||
     native(event.topic[0])!=="hoxo_spot"||native(event.topic[1])!=="settled")
    fail("wrong SpotSettled topics");
  const matchId=hex32(native(event.topic[2]));
  const data=native(event.value);
  if(!Array.isArray(data)||data.length!==7)fail("wrong SpotSettled vector length");
  const [maker,taker,baseToken,quoteToken,baseAmount,quoteAmount,settledLedger]=data;
  if(!G.test(asStr(maker))||!G.test(asStr(taker))||maker===taker||
     asStr(baseToken)!==M44_XLM_SAC||asStr(quoteToken)!==M44_USDC_SAC)
    fail("wrong settlement wallet or asset identity");
  const base=asInt(baseAmount),quote=asInt(quoteAmount);
  if(base<=0n||quote<=0n||base>1_000_000_000_000_000n||
     quote>1_000_000_000_000_000n)fail("unbounded settlement amount");
  const ledger=Number(event.ledger);
  if(!Number.isSafeInteger(ledger)||ledger<=0||
     !Number.isSafeInteger(settledLedger)||settledLedger!==ledger)
    fail("invalid event ledger");
  const txHash=asStr(event.txHash).toLowerCase();
  if(!HASH.test(txHash)||event.inSuccessfulContractCall===false)
    fail("transaction hash or successful call proof absent");
  return Object.freeze({
    matchId,transactionHash:txHash,ledger,maker,taker,
    baseAmountE7:base.toString(),quoteAmountE7:quote.toString(),
    priceQuotePerXlm:Number(quote)/Number(base), // display only; never used for trading
    ledgerClosedAt:typeof event.ledgerClosedAt==="string"?
       event.ledgerClosedAt:null
  });
}
export async function readM59VerifiedSpotActivity({
  server=new rpc.Server("https://soroban-testnet.stellar.org"),
  maxEvents=MAX_EVENTS,scanLedgers=SCAN_LEDGERS
}={}){
  if(!server||["getNetwork","getLatestLedger","getEvents","getTransaction"]
      .some(k=>typeof server[k]!=="function"))fail("official read-only RPC required");
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>100||
     !Number.isSafeInteger(scanLedgers)||scanLedgers<1||scanLedgers>10000)
    fail("unbounded event query");
  const net=await server.getNetwork();
  if(net?.passphrase!==TESTNET_PASSPHRASE)fail("not Stellar Testnet");
  const current=await server.getLatestLedger();
  const latest=Number(current?.sequence);
  if(!Number.isSafeInteger(latest)||latest<1)fail("invalid latest ledger");
  const start=Math.max(1,latest-scanLedgers);
  const result=await server.getEvents({
    startLedger:start,endLedger:latest,
    filters:[{type:"contract",contractIds:[M9_TESTNET_CONTRACT_ID]}],
    limit:maxEvents
  });
  if(!Array.isArray(result?.events)||!Number.isSafeInteger(result.latestLedger)||
     result.latestLedger<start)fail("live RPC event search unverified");
  const seen=new Set(),rows=[],errors=[];
  for(const item of result.events){
    // The filter may include other M9 events, such as admin actions. Ignore
    // them, but NEVER treat malformed SpotSettled events as verified volume.
    if(!Array.isArray(item?.topic)||item.topic.length!==3)continue;
    let first,second;
    try{first=native(item.topic[0]);second=native(item.topic[1]);}
    catch{continue;}
    if(first!=="hoxo_spot"||second!=="settled")continue;
    let event;
    try{event=normalizeM59SpotEvent(item);}
    catch(error){errors.push(String(error.message).slice(0,140));continue;}
    if(event.ledger<start||event.ledger>latest||seen.has(event.matchId))
      continue;
    seen.add(event.matchId);
    const tx=await server.getTransaction(event.transactionHash);
    if(tx?.status!=="SUCCESS"||
       tx.hash?.toLowerCase()!==event.transactionHash||
       tx.ledger!==event.ledger){
      errors.push("M9 event transaction finality not verified");
      continue;
    }
    rows.push(event);
  }
  // False "zero" is forbidden when a suspected settlement event couldn't
  // be independently validated. Return an error instead of hiding it.
  if(errors.length)fail(errors[0]);
  rows.sort((a,b)=>b.ledger-a.ledger||
    a.transactionHash.localeCompare(b.transactionHash));
  const baseTotal=rows.reduce((a,r)=>a+BigInt(r.baseAmountE7),0n);
  const quoteTotal=rows.reduce((a,r)=>a+BigInt(r.quoteAmountE7),0n);
  return Object.freeze({
    network:"Stellar Testnet",source:"M9 SpotSettled contract events + confirmed RPC transactions",
    contract:M9_TESTNET_CONTRACT_ID,latestLedger:latest,fromLedger:start,
    throughLedger:latest,scanLedgers:latest-start,
    isCompleteHistory:false,mayBeTruncated:result.events.length>=maxEvents,
    verifiedCount:rows.length,
    verifiedXlmVolumeE7:baseTotal.toString(),
    verifiedUsdcVolumeE7:quoteTotal.toString(),
    records:rows.slice(0,25),mocked:false
  });
}
