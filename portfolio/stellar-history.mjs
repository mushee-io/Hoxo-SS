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
const TYPES=new Set(["payment","create_account"]);
const FILTERED_TYPES=new Set([
  "path_payment_strict_receive","path_payment_strict_send",
  "account_merge","claim_claimable_balance","clawback"
]);
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
function identity(record,latestLedger,nowMs){
  if(!record||typeof record!=="object"||typeof record.id!=="string"||
     !CURSOR.test(record.id)||typeof record.paging_token!=="string"||
     !CURSOR.test(record.paging_token))ERROR("Missing valid operation identity/paging token");
  if(!HASH.test(record.transaction_hash||"")||record.transaction_successful!==true)
    ERROR("Unverified successful operation reference");
  // Horizon's PAYMENT OPERATION object commonly DOES NOT expose the ledger.
  // Do not invent one from the latest network ledger or a paging token.
  if(record.ledger!==undefined&&(!Number.isSafeInteger(record.ledger)||
     record.ledger<1||record.ledger>latestLedger))
    ERROR("Horizon operation ledger out of verified range");
  const ts=Date.parse(record.created_at);
  if(!Number.isFinite(ts)||ts>nowMs+15_000)ERROR("Invalid operation timestamp");
  return {createdAt:new Date(ts).toISOString(),ledger:record.ledger??null};
}
export function normalizePayment(record,owner,latestLedger,nowMs){
  if(!record||typeof record!=="object"||!TYPES.has(record.type))
    ERROR("Unsupported payment-like operation type");
  const meta=identity(record,latestLedger,nowMs);
  const creation=record.type==="create_account";
  const from=creation?record.funder:record.from;
  const to=creation?record.account:record.to;
  if(!isStellarGAddress(from)||!isStellarGAddress(to)||
     (from!==owner&&to!==owner))ERROR("Horizon payment not attributable to requested account");
  const asset=creation?{assetId:"XLM",code:"XLM",issuer:null}:assetOf(record);
  const direction=from===owner&&to===owner?"SELF":from===owner?"OUT":"IN";
  return Object.freeze({
    operationId:record.id,pagingToken:record.paging_token,
    txHash:record.transaction_hash.toLowerCase(),...meta,
    type:creation?"ACCOUNT_CREATION":"PAYMENT",
    direction,from,to,
    amount:positiveAmount(creation?record.starting_balance:record.amount),...asset,
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
      excludedOperationTypes:[],
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
  const ids=new Set(),cursors=new Set(),payments=[],excludedOperationTypes=[];
  for(const record of items){
    const meta=identity(record,proof.ledger,nowMs);
    void meta;
    if(ids.has(record.id)||cursors.has(record.paging_token))
      ERROR("Duplicate Horizon payment operation");
    ids.add(record.id);cursors.add(record.paging_token);
    if(FILTERED_TYPES.has(record.type)){
      // Path payment outputs are *not* a simple deposit/transfer amount.
      // Exclude but disclose, and preserve original paging tokens.
      excludedOperationTypes.push(record.type);
      continue;
    }
    payments.push(normalizePayment(record,owner,proof.ledger,nowMs));
  }
  const nextCursor=items.length===limit ? items.at(-1)?.paging_token??null:null;
  if(nextCursor!==null&&cursor!==null&&nextCursor===cursor)
    ERROR("Horizon page cursor did not advance");
  return {
    owner,network:"STELLAR_TESTNET",funded:true,observedLedger:proof.ledger,
    balances,payments,nextCursor,excludedOperationTypes,
    provenance:HORIZON_ACTIVITY_SOURCE,
    completeness:nextCursor?"PAGE_LIMIT_MORE_POSSIBLE":"CURRENT_PAGE_ONLY",
    executionPermitted:false,
  };
}
