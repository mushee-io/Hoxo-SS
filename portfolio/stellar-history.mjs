/**
 * HOXO SS M18 — public Stellar Testnet wallet activity (READ ONLY).
 * Horizon is an observed network indexer, not cryptographic proof of a
 * user's secret-key control, contract ownership or HOXO settlement.
 * No mainnet fallback, cross-domain pagination, synthetic trades or yields.
 */
import {TESTNET,validateHorizonRoot} from "../assets/testnet-status.mjs";
import {isStellarGAddress,normalizeBalances} from "../app/wallet-core.mjs";
export const HORIZON_ACTIVITY_SOURCE="STELLAR_TESTNET_HORIZON_REPORTED";
const maxItems=100;
const ERROR=message=>{throw Error(message);};
const HASH=/^[a-fA-F0-9]{64}$/;
const CURSOR=/^[0-9]{1,40}$/;
const AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/;
const TYPES=new Set(["payment","path_payment_strict_receive","path_payment_strict_send"]);
function limitNumber(value) {
  if(!Number.isSafeInteger(value)||value<1||value>maxItems)ERROR("Invalid history limit");
  return value;
}
function positiveAmount(value){
  if(typeof value!=="string"||!AMOUNT.test(value)||!/[1-9]/.test(value))
    ERROR("Invalid Horizon operation amount");
  return value;
}
async function request(url,fetchImpl,timeoutMs=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetchImpl(url,{method:"GET",
      headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});
    if(res?.status===404)return {notFound:true};
    if(!res?.ok)ERROR("Horizon wallet history HTTP "+String(res?.status));
    return {data:await res.json()};
  }finally{clearTimeout(timer);}
}
function assetOf(record){
  if(record.asset_type==="native")return {assetId:"XLM",code:"XLM",issuer:null};
  if(["credit_alphanum4","credit_alphanum12"].includes(record.asset_type)&&
    typeof record.asset_code==="string"&&/^[a-zA-Z0-9]{1,12}$/.test(record.asset_code)&&
    isStellarGAddress(record.asset_issuer)){
    return {assetId:record.asset_code+":"+record.asset_issuer,
      code:record.asset_code,issuer:record.asset_issuer};
  }
  ERROR("Unverified Horizon operation asset");
}
export function normalizePayment(record,owner,latestLedger,nowMs){
  if(!record||typeof record!=="object"||!TYPES.has(record.type))ERROR("Invalid Horizon payment operation type");
  if(typeof record.id!=="string"||!CURSOR.test(record.id)||
     typeof record.paging_token!=="string"||!CURSOR.test(record.paging_token)){
    ERROR("Missing valid operation identity/paging token");
  }
  if(!HASH.test(record.transaction_hash||"")||record.transaction_successful!==true)
    ERROR("Unverified successful operation reference");
  if(!Number.isSafeInteger(record.ledger)||record.ledger<=0||record.ledger>latestLedger)
    ERROR("Horizon operation ledger out of verified range");
  const ts=Date.parse(record.created_at);
  if(!Number.isFinite(ts)||ts>nowMs+15_000)ERROR("Invalid operation timestamp");
  // This endpoint promises a simple, ledger-attributed transfer history,
  // not path-payment route execution or DEX price information.
  if(record.type!=="payment")ERROR("Unsupported transfer type without full route metadata");
  if(!isStellarGAddress(record.from)||!isStellarGAddress(record.to)||
     (record.from!==owner&&record.to!==owner)){
    ERROR("Horizon payment not attributable to requested account");
  }
  const asset=assetOf(record);
  const direction=record.from===owner&&record.to===owner?"SELF":
    record.from===owner?"OUT":"IN";
  return Object.freeze({
    operationId:record.id,pagingToken:record.paging_token,
    txHash:record.transaction_hash.toLowerCase(),ledger:record.ledger,
    createdAt:new Date(ts).toISOString(),type:"PAYMENT",
    direction,from:record.from,to:record.to,
    amount:positiveAmount(record.amount),...asset,
    provenance:HORIZON_ACTIVITY_SOURCE,
    status:"HORIZON_REPORTED_SUCCESS",
    hoxoTrade:false,hoxoDeposit:false,
    onchainReported:true,
  });
}
export async function loadStellarWalletActivity(owner,{
  fetchImpl=fetch,nowMs=Date.now(),limit=25,cursor=null,
}={}){
  if(!isStellarGAddress(owner))ERROR("Invalid Stellar G-address for activity");
  limitNumber(limit);
  if(cursor!==null&&(typeof cursor!=="string"||!CURSOR.test(cursor)))
    ERROR("Invalid history cursor");
  if(typeof fetchImpl!=="function"||!Number.isFinite(nowMs))ERROR("Invalid history read configuration");
  const root=await request(TESTNET.horizon+"/",fetchImpl);
  if(!root.data)ERROR("Stellar Testnet network check unavailable");
  const proof=validateHorizonRoot(root.data,nowMs);
  if(proof.state!=="verified")ERROR("Stellar Testnet network verification failed: "+proof.message);
  const account=await request(TESTNET.horizon+"/accounts/"+encodeURIComponent(owner),fetchImpl);
  if(account.notFound){
    return {
      owner,network:"STELLAR_TESTNET",funded:false,
      observedLedger:proof.ledger,balances:[],payments:[],nextCursor:null,
      provenance:HORIZON_ACTIVITY_SOURCE,
      completeness:"ACCOUNT_UNFUNDED",executionPermitted:false,
    };
  }
  if(account.data?.account_id!==owner)ERROR("Horizon account identity mismatch");
  const balances=normalizeBalances(account.data.balances);
  const q=new URLSearchParams({order:"desc",limit:String(limit)});
  if(cursor!==null)q.set("cursor",cursor);
  const records=await request(TESTNET.horizon+"/accounts/"+encodeURIComponent(owner)+"/payments?"+q,fetchImpl);
  if(!records.data||!Array.isArray(records.data._embedded?.records))
    ERROR("Malformed Horizon payment page");
  const items=records.data._embedded.records;
  if(items.length>limit)ERROR("Horizon payment page exceeds requested bound");
  const ids=new Set(),cursors=new Set(),payments=[];
  for(const record of items){
    // Mixed operation types are not silently treated as transfers or trades.
    // A page containing a complex route fails closed rather than presenting
    // misleading payment amounts as an executed trade.
    const item=normalizePayment(record,owner,proof.ledger,nowMs);
    if(ids.has(item.operationId)||cursors.has(item.pagingToken))
      ERROR("Duplicate Horizon payment operation");
    ids.add(item.operationId);cursors.add(item.pagingToken);
    payments.push(item);
  }
  const nextCursor=items.length===limit ? payments.at(-1)?.pagingToken??null:null;
  if(nextCursor!==null&&cursor!==null&&nextCursor===cursor)
    ERROR("Horizon page cursor did not advance");
  return {
    owner,network:"STELLAR_TESTNET",funded:true,observedLedger:proof.ledger,
    balances,payments,nextCursor,provenance:HORIZON_ACTIVITY_SOURCE,
    completeness:nextCursor?"PAGE_LIMIT_MORE_POSSIBLE":"CURRENT_PAGE_ONLY",
    executionPermitted:false,
  };
}
