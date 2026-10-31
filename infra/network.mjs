/**
 * M4 — read-only Stellar Testnet RPC and Horizon network diagnostics.
 * No transaction signing or broadcasting. Diagnostic readiness is NOT exchange readiness.
 */
import {validateHorizonRoot} from "../assets/testnet-status.mjs";
import {TESTNET_CONFIG,TESTNET_PASSPHRASE,MAX_LEDGER_AGE_MS,MAX_LEDGER_DELTA} from "../config/testnet.mjs";
const errorResult=(state,message)=>({state,ledger:null,closeTime:null,message});
function ledgerInfo(sequence, closeTimeSec, nowMs){
  if(!Number.isSafeInteger(sequence)||sequence<1)return null;
  if(!/^\d{10,12}$/.test(String(closeTimeSec)))return null;
  const stamp=Number(closeTimeSec)*1000;
  if(!Number.isSafeInteger(stamp))return null;
  const age=nowMs-stamp;
  if(age>MAX_LEDGER_AGE_MS||age< -15_000)return {stale:true,sequence,stamp};
  return {stale:false,sequence,stamp};
}
async function readResponse(response){
  if(!response?.ok)throw Error("Endpoint HTTP error");
  return await response.json();
}
async function rpcCall(config,method,{fetchImpl,signal}){
  const data=await readResponse(await fetchImpl(config.rpc,{
    method:"POST",
    headers:{"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:method,method}),
    signal,
    cache:"no-store"
  }));
  if(data?.jsonrpc!=="2.0"||data.id!==method||data.error||!data.result||
    typeof data.result!=="object"||Array.isArray(data.result)){
    throw new Error("Invalid Stellar RPC response: "+method);
  }
  return data.result;
}
export function validateRpcResult({network,health,latest},nowMs=Date.now()){
  if(!network||network.passphrase!==TESTNET_PASSPHRASE){
    return errorResult("mismatch","RPC network passphrase is not Stellar Testnet.");
  }
  if(!health||health.status!=="healthy"){
    return errorResult("degraded","RPC node does not report healthy status.");
  }
  const sequence=Number(latest?.sequence);
  const newest=ledgerInfo(sequence,latest?.closeTime,nowMs);
  if(!newest)return errorResult("unavailable","RPC latest ledger sequence/close time missing or malformed.");
  if(newest.stale)return errorResult("stale","RPC latest ledger close is stale or from the future.");
  const healthLedger=Number(health.latestLedger);
  const oldestLedger=Number(health.oldestLedger);
  if(!Number.isSafeInteger(healthLedger)||healthLedger<1||
     !Number.isSafeInteger(oldestLedger)||oldestLedger<1||oldestLedger>healthLedger||
     Math.abs(healthLedger-sequence)>3){
    return errorResult("degraded","RPC node's health/ledger sequences disagree.");
  }
  if(health.latestLedgerCloseTime!==undefined&&health.latestLedgerCloseTime!==null){
    const healthStamp=ledgerInfo(healthLedger,health.latestLedgerCloseTime,nowMs);
    if(!healthStamp||healthStamp.stale||
       Math.abs(healthStamp.stamp-newest.stamp)>30_000){
      return errorResult("stale","RPC health ledger close timestamp is stale or inconsistent.");
    }
  }
  return {
    state:"verified",ledger:sequence,closeTime:new Date(newest.stamp).toISOString(),
    protocolVersion:latest.protocolVersion??network.protocolVersion??null,
    oldestLedger,retentionWindow:Number(health.ledgerRetentionWindow)||null,
    message:"Stellar RPC is healthy on Testnet. No exchange contract deployments are implied."
  };
}
export async function probeRpc({config=TESTNET_CONFIG,fetchImpl=globalThis.fetch,nowMs=Date.now(),timeoutMs=12_000}={}){
  if(typeof fetchImpl!=="function")return errorResult("unavailable","RPC fetch is unavailable.");
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const network=await rpcCall(config,"getNetwork",{fetchImpl,signal:ctrl.signal});
    if(network.passphrase!==TESTNET_PASSPHRASE)return errorResult("mismatch","RPC connected to a non-Testnet network.");
    const [health,latest]=await Promise.all([
      rpcCall(config,"getHealth",{fetchImpl,signal:ctrl.signal}),
      rpcCall(config,"getLatestLedger",{fetchImpl,signal:ctrl.signal})
    ]);
    return validateRpcResult({network,health,latest},nowMs);
  }catch(error){
    return errorResult("unavailable","Stellar RPC verification unavailable: "+String(error.message||error));
  }finally{clearTimeout(timer);}
}
export async function probeHorizon({config=TESTNET_CONFIG,fetchImpl=globalThis.fetch,nowMs=Date.now(),timeoutMs=12_000}={}){
  if(typeof fetchImpl!=="function")return errorResult("unavailable","Horizon fetch is unavailable.");
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const root=await readResponse(await fetchImpl(config.horizon+"/",{
      method:"GET",headers:{Accept:"application/json"},signal:ctrl.signal,cache:"no-store"
    }));
    return validateHorizonRoot(root,nowMs);
  }catch(error){
    return errorResult("unavailable","Horizon verification unavailable: "+String(error.message||error));
  }finally{clearTimeout(timer);}
}
export function reconcileEndpoints(horizon,rpc){
  if(horizon.state!=="verified"||rpc.state!=="verified"){
    return {state:"unavailable",ledgerDelta:null,
      message:"Horizon and Stellar RPC must BOTH verify on Testnet before marking the infrastructure ready."};
  }
  const delta=Math.abs(horizon.ledger-rpc.ledger);
  if(delta>MAX_LEDGER_DELTA){
    return {state:"out-of-sync",ledgerDelta:delta,
      message:"Stellar Testnet endpoints disagree on ledger height beyond the allowed lag."};
  }
  return {state:"verified",ledgerDelta:delta,
    message:"Horizon and Stellar RPC verify Testnet and have compatible recent ledgers. Exchange contracts are not deployed."};
}
export async function probeInfrastructure(options={}){
  const [horizon,rpc]=await Promise.all([probeHorizon(options),probeRpc(options)]);
  return {horizon,rpc,...reconcileEndpoints(horizon,rpc)};
}
