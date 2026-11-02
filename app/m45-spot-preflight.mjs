/**
 * M45 live, public-only Stellar Testnet preflight for the controlled M9
 * bilateral wallet signing lab. Never calls a transaction method or signs.
 * Reports pause as an explicit BLOCKER, never as a reason to unpause.
 */
import {Asset,Networks,rpc} from "@stellar/stellar-sdk";
import {M44_XLM_SAC,M44_USDC_SAC} from "./m44-stellar-xdr-verifier.mjs";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";

export const M45_CANDIDATE=Object.freeze({
  contract:M9_TESTNET_CONTRACT_ID,
  maker:"GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB",
  taker:"GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2",
  quoteIssuer:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  wasmSha256:"916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3",
  rpc:"https://soroban-testnet.stellar.org",
  horizon:"https://horizon-testnet.stellar.org"
});
const MAX_LEDGER_DELTA=24;
const MAX_AGE_MS=120_000;
function assert(value,message){if(!value)throw Error("M45 preflight: "+message);}
function e7(s,name){
  assert(typeof s==="string"&&/^(0|[1-9]\d*)\.\d{7}$/.test(s),name+" is not an exact 7-decimal balance");
  let [w,f]=s.split(".");
  return (BigInt(w)*10_000_000n+BigInt(f)).toString();
}
function requireRead(result,name){
  assert(result?.isReadCall===true,name+" must be verified as read-only RPC");
  return result.result;
}
function decodeAccount(obj,owner,candidate){
  assert(obj?.account_id===owner&&Array.isArray(obj.balances),"account identity/balances mismatch: "+owner);
  const native=obj.balances.filter(x=>x.asset_type==="native");
  const usdc=obj.balances.filter(x=>x.asset_type==="credit_alphanum4"&&
    x.asset_code==="USDC"&&x.asset_issuer===candidate.quoteIssuer);
  assert(native.length===1&&usdc.length<=1,"unexpected duplicate wallet asset entries");
  const authorized=usdc.length===1&&usdc[0].is_authorized===true;
  return Object.freeze({
    address:owner,xlmE7:e7(native[0].balance,"XLM"),
    usdcE7:usdc.length?e7(usdc[0].balance,"USDC"):"0",
    trustlineAuthorized:authorized
  });
}
async function readJson(fetchImpl,url){
  const response=await fetchImpl(url,{method:"GET",headers:{accept:"application/json"},cache:"no-store"});
  assert(response?.ok===true,"Horizon request failed");
  return response.json();
}
async function wasmSha256(bytes){
  assert(bytes instanceof Uint8Array&&bytes.length>8&&bytes.length<10000000,
    "deployed WASM unavailable");
  assert(typeof crypto!=="undefined"&&crypto.subtle,"secure SHA-256 API unavailable");
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function checkM45TestnetPreflight({
  server,fetchImpl=fetch,nowMs=Date.now(),candidate=M45_CANDIDATE
}={}){
  assert(server&&["getNetwork","getLatestLedger","getContractInstance",
    "getContractWasmByContractId","queryContract"].every(k=>typeof server[k]==="function"),
    "read-only Stellar RPC methods required");
  assert(typeof fetchImpl==="function","Horizon HTTP client required");
  assert(Asset.native().contractId(TESTNET_PASSPHRASE)===M44_XLM_SAC,
    "native XLM SAC derivation differs");
  assert(new Asset("USDC",candidate.quoteIssuer).contractId(TESTNET_PASSPHRASE)===M44_USDC_SAC,
    "USDC SAC derivation differs");
  assert(candidate.contract===M9_TESTNET_CONTRACT_ID&&candidate.maker===M45_CANDIDATE.maker&&
    candidate.taker===M45_CANDIDATE.taker&&candidate.wasmSha256===M45_CANDIDATE.wasmSha256,
    "unauthorized contract, wallet or WASM substitution");
  const [network,ledger,horizonRoot,wasm,instance]=await Promise.all([
    server.getNetwork(),server.getLatestLedger(),
    readJson(fetchImpl,candidate.horizon+"/"),
    server.getContractWasmByContractId(candidate.contract),
    server.getContractInstance(candidate.contract)
  ]);
  assert(network?.passphrase===Networks.TESTNET&&horizonRoot?.network_passphrase===TESTNET_PASSPHRASE,
    "wrong Stellar network");
  assert(Boolean(instance),"M9 is not deployed");
  assert(await wasmSha256(wasm)===candidate.wasmSha256,"deployed M9 WASM hash mismatch");
  const rpcLedger=Number(ledger?.sequence),horizonLedger=Number(horizonRoot.history_latest_ledger);
  assert(Number.isSafeInteger(rpcLedger)&&rpcLedger>0&&Number.isSafeInteger(horizonLedger)&&
    horizonLedger>0&&Math.abs(horizonLedger-rpcLedger)<=MAX_LEDGER_DELTA,
    "Horizon/RPC ledger disagreement");
  const closedAt=Date.parse(horizonRoot.history_latest_ledger_closed_at);
  assert(Number.isFinite(closedAt)&&Number.isFinite(nowMs)&&
    closedAt<=nowMs+15000&&nowMs-closedAt<=MAX_AGE_MS,
    "Horizon ledger is stale");
  const [admin,paused,baseAllowed,quoteAllowed,baseDecimals,quoteDecimals,makerRaw,takerRaw]=await Promise.all([
    server.queryContract(candidate.contract,"admin").then(r=>requireRead(r,"admin")),
    server.queryContract(candidate.contract,"paused").then(r=>requireRead(r,"paused")),
    server.queryContract(candidate.contract,"allowed",{asset:M44_XLM_SAC}).then(r=>requireRead(r,"base allowed")),
    server.queryContract(candidate.contract,"allowed",{asset:M44_USDC_SAC}).then(r=>requireRead(r,"quote allowed")),
    server.queryContract(M44_XLM_SAC,"decimals").then(r=>requireRead(r,"base decimals")),
    server.queryContract(M44_USDC_SAC,"decimals").then(r=>requireRead(r,"quote decimals")),
    readJson(fetchImpl,candidate.horizon+"/accounts/"+candidate.maker),
    readJson(fetchImpl,candidate.horizon+"/accounts/"+candidate.taker)
  ]);
  assert(admin===candidate.maker,"M9 admin does not match Wallet 1");
  assert(typeof paused==="boolean"&&typeof baseAllowed==="boolean"&&typeof quoteAllowed==="boolean",
    "M9 contract booleans are not verified");
  assert((baseDecimals===7||baseDecimals===7n)&&(quoteDecimals===7||quoteDecimals===7n),
    "unexpected token decimals");
  const maker=decodeAccount(makerRaw,candidate.maker,candidate);
  const taker=decodeAccount(takerRaw,candidate.taker,candidate);
  const blockers=[];
  if(!baseAllowed)blockers.push("XLM not approved in M9");
  if(!quoteAllowed)blockers.push("USDC not approved in M9");
  if(!maker.trustlineAuthorized||!taker.trustlineAuthorized)blockers.push("USDC trustline not authorized");
  if(BigInt(maker.xlmE7)<=10000000n||BigInt(taker.xlmE7)<=10000000n)
    blockers.push("Insufficient native XLM reserve");
  if(BigInt(taker.usdcE7)===0n)blockers.push("Wallet 2 has no test USDC");
  if(paused)blockers.push("M9 settlement remains paused (expected safety gate)");
  return Object.freeze({
    state:paused?"PAUSED_REVIEW_ONLY":blockers.length?"BLOCKED":"ASSETS_VERIFIED_ONLY",
    contract:M9_TESTNET_CONTRACT_ID,network:"Stellar Testnet",verifiedWasm:true,
    ledger:rpcLedger,horizonLedger,observedAtMs:nowMs,contractPaused:paused,
    baseAllowed,quoteAllowed,wallets:Object.freeze([maker,taker]),
    blockers:Object.freeze(blockers),readyForSimulation:!blockers.length,
    signEnabled:false,broadcast:false,executionPermitted:false
  });
}
/** Browser callable, every attempt re-reads current public state. */
export async function probeM45TestnetPreflight({server,fetchImpl=fetch,nowMs=Date.now()}={}){
  return checkM45TestnetPreflight({server:server??new rpc.Server(M45_CANDIDATE.rpc),
    fetchImpl,nowMs});
}
