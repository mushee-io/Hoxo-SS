/**
 * M50 — independent public Stellar Testnet classic DEX account portfolio.
 *
 * Correctly distinguishes Horizon CLASSIC DEX offers/trades from Hoxo
 * Soroban order matching, perp executions, lending and protocol PnL.
 * No signing, no local storage, no mutation, no mainnet fallback.
 */
import {loadTestnetAccount,isStellarGAddress} from "../app/wallet-core.mjs";
import {HORIZON} from "../app/wallet-core.mjs";
const ASSET_RE=/^[a-zA-Z0-9]{1,12}$/;
const DEC=/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const TRADEREF=/^[0-9]+(?:-[0-9]+)?$/;
const MAX=20;
function fail(message){throw Error("M50 portfolio: "+message);}
function amount(v,name){
  if(typeof v!=="string"||!DEC.test(v)||!/[1-9]/.test(v))fail("invalid "+name);
  return v;
}
function asset(entry){
  if(!entry||typeof entry!=="object")fail("invalid asset");
  if(entry.asset_type==="native")return Object.freeze({code:"XLM",issuer:null,assetId:"XLM"});
  if(!["credit_alphanum4","credit_alphanum12"].includes(entry.asset_type)||
     typeof entry.asset_code!=="string"||!ASSET_RE.test(entry.asset_code)||
     !isStellarGAddress(entry.asset_issuer))fail("invalid asset identity");
  return Object.freeze({code:entry.asset_code,issuer:entry.asset_issuer,
    assetId:entry.asset_code+":"+entry.asset_issuer});
}
export function normalizeM50Offer(row,owner,ledger){
  if(!row||typeof row!=="object"||row.seller!==owner||
     !/^[1-9]\d*$/.test(String(row.id))||
     !Number.isSafeInteger(row.last_modified_ledger)||
     row.last_modified_ledger<1||row.last_modified_ledger>ledger)
    fail("unverified owner or offer ledger");
  const sell=asset(row.selling),buy=asset(row.buying);
  if(sell.assetId===buy.assetId)fail("same-asset offer");
  const q=row.price_r;
  if(!q||!Number.isSafeInteger(q.n)||!Number.isSafeInteger(q.d)||
     q.n<=0||q.d<=0||q.n>2147483647||q.d>2147483647)
    fail("invalid offer price ratio");
  return Object.freeze({id:String(row.id),selling:sell,buying:buy,
    amount:amount(row.amount,"offer amount"),priceRatio:Object.freeze({n:q.n,d:q.d}),
    lastModifiedLedger:row.last_modified_ledger,
    source:"STELLAR_TESTNET_CLASSIC_DEX",hoxoOrder:false,tradeExecutable:false});
}
export function normalizeM50Trade(row,owner,nowMs){
  if(!row||typeof row!=="object"||typeof row.id!=="string"||
     !TRADEREF.test(row.id)||row.paging_token!==row.id||
     !isStellarGAddress(row.base_account)||!isStellarGAddress(row.counter_account)||
     (row.base_account!==owner&&row.counter_account!==owner))
    fail("unverified classic DEX trade ownership");
  if(!["orderbook","liquidity_pools"].includes(row.trade_type))
    fail("unknown trade mechanism");
  const createdAt=Date.parse(row.ledger_close_time);
  if(!Number.isFinite(createdAt)||createdAt>nowMs+15000)
    fail("unverified trade timestamp");
  const base=asset({
    asset_type:row.base_asset_type,
    asset_code:row.base_asset_code,
    asset_issuer:row.base_asset_issuer
  });
  const counter=asset({
    asset_type:row.counter_asset_type,
    asset_code:row.counter_asset_code,
    asset_issuer:row.counter_asset_issuer
  });
  if(base.assetId===counter.assetId)fail("same-asset trade");
  return Object.freeze({id:row.id,pagingToken:row.paging_token,
    createdAt:new Date(createdAt).toISOString(),
    base,counter,baseAmount:amount(row.base_amount,"base amount"),
    counterAmount:amount(row.counter_amount,"counter amount"),
    mechanism:row.trade_type,
    direction:row.base_account===owner&&row.counter_account===owner?"SELF":
      row.base_account===owner?"BASE":"COUNTER",
    source:"STELLAR_TESTNET_CLASSIC_DEX",hoxoTrade:false,perpTrade:false,
    hoxoVolumeE7:"0",fundingE7:null,pnlE7:null});
}
async function readPage(url,fetchImpl){
  const response=await fetchImpl(url,{
    method:"GET",headers:{Accept:"application/json"},cache:"no-store"
  });
  if(!response?.ok)fail("Horizon account history HTTP unavailable");
  const json=await response.json();
  if(!json||!Array.isArray(json._embedded?.records)||json._embedded.records.length>MAX)
    fail("malformed or oversized Horizon history page");
  return json._embedded.records;
}
export async function loadM50ClassicDexPortfolio(owner,{
  fetchImpl=fetch,nowMs=Date.now(),includeOffers=true,includeTrades=true
}={}){
  if(!isStellarGAddress(owner))fail("invalid public Stellar account");
  if(!Number.isFinite(nowMs)||typeof fetchImpl!=="function")fail("invalid request");
  const account=await loadTestnetAccount(owner,{fetchImpl,nowMs});
  if(!account.funded)return Object.freeze({owner,ledger:account.ledger,
    balances:[],offers:[],trades:[],funded:false,
    hoxoPositionsVerified:false,executionPermitted:false});
  const base=HORIZON+"/accounts/"+encodeURIComponent(owner);
  const suffix="?order=desc&limit="+MAX;
  const [offerRows,tradeRows]=await Promise.all([
    includeOffers?readPage(base+"/offers"+suffix,fetchImpl):[],
    includeTrades?readPage(base+"/trades"+suffix,fetchImpl):[]
  ]);
  const offers=offerRows.map(row=>normalizeM50Offer(row,owner,account.ledger));
  const trades=tradeRows.map(row=>normalizeM50Trade(row,owner,nowMs));
  if(new Set(offers.map(x=>x.id)).size!==offers.length)fail("duplicate account offer");
  if(new Set(trades.map(x=>x.id)).size!==trades.length)fail("duplicate classic trade");
  return Object.freeze({
    owner,ledger:account.ledger,balances:Object.freeze(account.balances),
    offers:Object.freeze(offers),trades:Object.freeze(trades),funded:true,
    provenance:"STELLAR_TESTNET_HORIZON_REPORTED",
    offersCompleteness:"LATEST_20_ONLY",tradesCompleteness:"LATEST_20_ONLY",
    hoxoOrdersVerified:false,hoxoPositionsVerified:false,
    hoxoSettlementsVerified:false,executionPermitted:false
  });
}
