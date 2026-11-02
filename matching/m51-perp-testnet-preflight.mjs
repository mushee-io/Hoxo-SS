/**
 * M51 — verifiable Soroban TESTNET XLM-PERP long/short open preflight.
 *
 * This is *not* a Hyperliquid trading adapter. It prepares exact bilateral
 * Hoxo M12 on-chain terms only after real deployment, canonical risk/oracle
 * evidence, two independent accounts, valid escrow funding and solvency.
 * No signature requests, contract mutation, tx submission or synthetic fill.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {isStellarContractId} from "../infra/registry.mjs";
export const TESTNET_PASSPHRASE="Test SDF Network ; September 2015";
export const TESTNET_USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const REQUIRED=["perp-clearinghouse","oracle-adapter","risk-engine","unified-margin"];
const POSITIVE=/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const FULL_SHA=/^[0-9a-f]{64}$/i;
const MAX_E7=1_000_000_000_000_000n;
function fail(reason){throw Error("M51 XLM-PERP: "+reason);}
function asUnits(value,label){
  if(typeof value!=="string"||!POSITIVE.test(value))fail("invalid "+label+" 7-decimal amount");
  const [major,minor=""]=value.split(".");
  const n=BigInt(major)*10_000_000n+BigInt(minor.padEnd(7,"0")||"0");
  if(n<=0n||n>MAX_E7)fail(label+" outside M12 limits");
  return n;
}
function int(value,label){
  if(!Number.isSafeInteger(value)||value<1)fail("invalid "+label);
  return value;
}
function exactRegistry(registry){
  if(!registry||registry.network!=="testnet"||
    registry.passphrase!==TESTNET_PASSPHRASE||!Array.isArray(registry.contracts))
    fail("exact canonical Testnet registry required");
  const ids={};
  for(const role of REQUIRED){
    const matches=registry.contracts.filter(r=>r?.role===role);
    if(matches.length!==1)fail("missing or duplicate "+role+" registry entry");
    const r=matches[0];
    if(r.status!=="verified"||!isStellarContractId(r.contractId)||
       !FULL_SHA.test(r.wasmSha256??"")||
       !FULL_SHA.test(r.deploymentTxHash??"")||
       !Number.isSafeInteger(r.verifiedAtLedger)||r.verifiedAtLedger<1)
      fail(role+" has no independently verified on-chain deployment");
    ids[role]=r;
  }
  if(new Set(Object.values(ids).map(x=>x.contractId)).size!==REQUIRED.length)
    fail("perp, oracle, risk, margin contract addresses must differ");
  return ids;
}
export function prepareM51PerpTerms({
  maker,taker,action,quantityXlm,limitPriceUsd,markPriceUsd,ledger,positionId
}={}){
  if(!isStellarGAddress(maker)||!isStellarGAddress(taker)||maker===taker)
    fail("two distinct canonical Testnet G-accounts required");
  if(!["long","short"].includes(action))fail("action must be long or short XLM");
  if(typeof positionId!=="string"||!FULL_SHA.test(positionId))
    fail("unique 32-byte position ID required");
  const quantity=asUnits(quantityXlm,"XLM quantity");
  const limit=asUnits(limitPriceUsd,"limit USD reference price");
  const mark=asUnits(markPriceUsd,"verified on-chain mark");
  if(action==="long"&&mark>limit)fail("long limit would be violated");
  if(action==="short"&&mark<limit)fail("short limit would be violated");
  const now=int(ledger,"current Testnet ledger");
  if(now>0xffffffff-15)fail("ledger expiry overflow");
  return Object.freeze({
    positionId:positionId.toLowerCase(),market:"xlm-usdc-perp",
    networkPassphrase:TESTNET_PASSPHRASE,
    long:action==="long"?maker:taker,
    short:action==="long"?taker:maker,
    quantityE7:quantity.toString(),
    longMaxE7:action==="long"?limit.toString():mark.toString(),
    shortMinE7:action==="short"?limit.toString():mark.toString(),
    markE7:mark.toString(),expiresAtLedger:now+15,
    operatorAction:action,signaturesApplied:false,submissionPermitted:false
  });
}
function readVerified(reply,method){
  if(reply?.isReadCall!==true)fail("read-only Soroban "+method+" proof required");
  return reply.result;
}
export async function preflightM51XlmPerp({
  registry,server,maker,taker,action,quantityXlm,limitPriceUsd,positionId
}={}){
  const ids=exactRegistry(registry); // Stop before RPC on incomplete deploys
  if(!server||["getNetwork","getLatestLedger","getContractInstance",
    "getContractWasmByContractId","queryContract"].some(k=>typeof server[k]!=="function"))
    fail("real Stellar RPC required");
  const network=await server.getNetwork();
  if(network?.passphrase!==TESTNET_PASSPHRASE)fail("wrong Stellar network");
  const latest=await server.getLatestLedger();
  const seq=int(Number(latest?.sequence),"current Testnet ledger");
  if(Object.values(ids).some(x=>x.verifiedAtLedger>seq))
    fail("deployment evidence claims a future ledger");
  // Match deployed executable bytes to a canonical independently approved hash.
  for(const entry of Object.values(ids)){
    const instance=await server.getContractInstance(entry.contractId);
    if(!instance)fail("contract instance missing");
    const bytes=await server.getContractWasmByContractId(entry.contractId);
    if(!(bytes instanceof Uint8Array)||bytes.length<12)fail("deployed executable unavailable");
    if(typeof crypto==="undefined"||!crypto.subtle)fail("secure WASM hashing unavailable");
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const actual=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
    if(actual!==entry.wasmSha256.toLowerCase())
      fail("deployed WASM differs from independently approved "+entry.role);
  }
  const perp=ids["perp-clearinghouse"].contractId;
  const market=readVerified(await server.queryContract(perp,"market"),"market");
  const solvent=readVerified(await server.queryContract(perp,"solvent"),"solvent");
  const exposure=readVerified(await server.queryContract(perp,"market_exposure"),"market_exposure");
  if(market?.market_id!==1||market?.collateral_token!==TESTNET_USDC_SAC||
     market?.paused!==false||market?.entry_gate_configured!==true||
     market.oracle_configured!==true||market.risk_configured!==true||
     !Number.isSafeInteger(market.initial_margin_bps)||market.initial_margin_bps<100||
     market.initial_margin_bps>10000||!Number.isSafeInteger(market.maintenance_margin_bps)||
     market.maintenance_margin_bps<=0||market.maintenance_margin_bps>=market.initial_margin_bps||
     solvent!==true||exposure?.index_complete!==true||
     exposure?.token_book_backed!==true||exposure?.insurance_snapshot_covered!==true||
     exposure?.system_risk_approved!==true)
    fail("perp contract risk/collateral/solvency gate not verified");
  const oracle=ids["oracle-adapter"].contractId;
  const quote=readVerified(await server.queryContract(oracle,"current",{market_id:1}),"oracle current");
  if(!quote||typeof quote.mark_e7!=="bigint"||quote.mark_e7<=0n||
     typeof quote.index_e7!=="bigint"||quote.index_e7<=0n||
     !Number.isSafeInteger(quote.last_update_sec)||quote.last_update_sec<=0)
    fail("invalid independent on-chain price proof");
  const nowSec=Number(latest?.closeTime);
  if(!Number.isSafeInteger(nowSec)||nowSec-quote.last_update_sec>120||
     quote.last_update_sec>nowSec+10)
    fail("perp oracle quote is stale or future-dated");
  if(quote.mark_e7*10n>quote.index_e7*11n||
     quote.index_e7*10n>quote.mark_e7*11n)
    fail("perp oracle mark/index deviates more than ten percent");
  // Collateral is isolated M12 escrow. A connected wallet's Horizon balance
  // is NOT usable margin. Verify the on-chain M12 wallet.available_e7.
  const [a,b]=await Promise.all([maker,taker].map(async owner=>{
    if(!isStellarGAddress(owner))fail("invalid bilateral wallet");
    return readVerified(await server.queryContract(perp,"wallet",{owner}),"wallet");
  }));
  const terms=prepareM51PerpTerms({
    maker,taker,action,quantityXlm,limitPriceUsd,
    markPriceUsd:(quote.mark_e7/10_000_000n).toString()+"."+
      (quote.mark_e7%10_000_000n).toString().padStart(7,"0"),
    ledger:seq,positionId
  });
  const nominal=BigInt(terms.quantityE7)*BigInt(terms.markE7)/10_000_000n;
  const margin=(nominal*BigInt(market.initial_margin_bps)+9999n)/10000n;
  const fee=(nominal*BigInt(market.fee_bps??0)+9999n)/10000n;
  const needed=margin+fee;
  if(needed<=0n||!a||!b||typeof a.available_e7!=="bigint"||
     typeof b.available_e7!=="bigint"||
     a.available_e7<needed||b.available_e7<needed)
    fail("insufficient verified isolated margin for both long/short wallets");
  return Object.freeze({
    ...terms,contractId:perp,verifiedLedger:seq,
    isolatedMarginEachE7:needed.toString(),
    sorobanSimulationRequired:true,
    signedUserConsentRequired:true,
    riskAndOracleSourcesVerified:true,
    executionPermitted:false, // separate authenticated signed-simulation and send
    broadcast:false
  });
}
