/**
 * M5 verified Stellar Testnet Horizon market-data readers.
 * No issued-asset issuer is assumed. Candidate pairs must have an explicitly
 * registered base/quote; read-only market data NEVER authorizes risk/execution.
 */
import {TESTNET_CONFIG} from "../config/testnet.mjs";
import {probeHorizon} from "../infra/network.mjs";
import {queryPair,configuredPair,validateAsset,PERIODS,parsePositive,toFixed,SCALE} from "./model.mjs";
export const MARKET_DATA_SOURCE="Stellar Testnet Horizon / read-only observed SDEX activity";
const err=(state,message)=>({state,message,source:MARKET_DATA_SOURCE,records:[],candles:[],book:null,price:null,tradable:false});
function decimalPositive(s){
  return parsePositive(s);
}
function clampTime(value,nowMs){
  const t=Date.parse(value);
  if(!Number.isFinite(t)||t>nowMs+15000||t<0)throw Error("Invalid trade timestamp");
  return t;
}
function matchesAsset(record,prefix,expected){
  if(record[prefix+"_asset_type"]!==expected.asset_type)return false;
  if(expected.asset_type!=="native"&&(record[prefix+"_asset_code"]!==expected.asset_code||
     record[prefix+"_asset_issuer"]!==expected.asset_issuer))return false;
  return true;
}
function assetLabel(row,prefix){
  const type=row[prefix+"_asset_type"];
  if(type==="native")return "XLM";
  const asset=validateAsset({
    type,code:row[prefix+"_asset_code"],issuer:row[prefix+"_asset_issuer"]
  });
  return asset.asset_code+" · "+asset.asset_issuer.slice(0,6)+"…"+asset.asset_issuer.slice(-4);
}
async function apiGet(path,opts){
  const {config,fetchImpl,signal}=opts;
  const res=await fetchImpl(config.horizon+path,{
    method:"GET",cache:"no-store",headers:{Accept:"application/json"},signal
  });
  if(!res?.ok)throw Error("Horizon data endpoint HTTP "+(res?.status??"error"));
  const data=await res.json();
  if(!data||typeof data!=="object")throw Error("Invalid Horizon response");
  return data;
}
async function verifiedRequest(op,{config=TESTNET_CONFIG,fetchImpl=globalThis.fetch,nowMs=Date.now(),timeoutMs=13000}={}){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const net=await probeHorizon({config,fetchImpl,nowMs,timeoutMs});
    if(net.state!=="verified")return err("unverified","Stellar Testnet Horizon network proof failed: "+net.message);
    return await op({config,fetchImpl,nowMs,signal:ctrl.signal,ledger:net.ledger});
  }catch(e){return err("unavailable","Verified Testnet market data unavailable: "+String(e?.message||e));}
  finally{clearTimeout(timer);}
}
export function parseNetworkTrade(row,nowMs=Date.now()){
  if(!row||typeof row.id!=="string"||!row.id||
     typeof row.ledger_close_time!=="string")throw Error("Invalid trade record");
  const timestamp=clampTime(row.ledger_close_time,nowMs);
  const base=assetLabel(row,"base"),counter=assetLabel(row,"counter");
  const baseAmount=decimalPositive(row.base_amount),counterAmount=decimalPositive(row.counter_amount);
  return {
    id:row.id,timestamp,base,counter,
    baseAmount:toFixed(baseAmount),counterAmount:toFixed(counterAmount),
    source:"Stellar Horizon Testnet ledger trade",
    isRecent:nowMs-timestamp<=60*60*1000
  };
}
/** Independent activity viewer: arbitrary on-chain pairs, NOT exchange order fills. */
export async function loadRecentNetworkTrades(options={}){
  return verifiedRequest(async ctx=>{
    const result=await apiGet("/trades?order=desc&limit=20",ctx);
    const raw=result?._embedded?.records;
    if(!Array.isArray(raw))throw Error("Horizon trades response has no records");
    const records=raw.map(x=>parseNetworkTrade(x,ctx.nowMs))
      .filter(x=>x.timestamp>=ctx.nowMs-24*3600000).slice(0,12);
    return {
      state:records.length?"observed":"empty",source:MARKET_DATA_SOURCE,ledger:ctx.ledger,
      records,candles:[],book:null,price:null,tradable:false,
      message:records.length?"Real recent Stellar Testnet trades from unrelated network markets; NOT Hoxo exchange fills or a risk oracle.":"No Testnet trades observed in the past 24 hours."
    };
  },options);
}
function parseBookEntry(entry){
  const price=decimalPositive(entry?.price),amount=decimalPositive(entry?.amount);
  if(price<=0n||amount<=0n)throw Error("Malformed order-book level");
  return {price:toFixed(price),amount:toFixed(amount)};
}
export function normalizeOrderBook(result,pair){
  if(!result||!Array.isArray(result.bids)||!Array.isArray(result.asks)||
      !result.base||!result.counter||
      !Object.entries(pair.base).every(([k,v])=>result.base[k]===v)||
      !Object.entries(pair.counter).every(([k,v])=>result.counter[k]===v))throw Error("Order book asset identity mismatch");
  const bids=result.bids.slice(0,20).map(parseBookEntry);
  const asks=result.asks.slice(0,20).map(parseBookEntry);
  const bidPrices=bids.map(x=>decimalPositive(x.price));
  const askPrices=asks.map(x=>decimalPositive(x.price));
  if(bidPrices.some((v,i)=>i&&v>bidPrices[i-1])||
     askPrices.some((v,i)=>i&&v<askPrices[i-1]))throw Error("Order book price ordering is invalid");
  const bestBid=bidPrices[0]??null,bestAsk=askPrices[0]??null;
  if(bestBid!==null&&bestAsk!==null&&bestBid>=bestAsk)throw Error("Crossed/locked order book");
  return {bids,asks,mid:(bestBid&&bestAsk)?toFixed((bestBid+bestAsk)/2n):null,
    source:MARKET_DATA_SOURCE,sourceKind:"Classic Stellar SDEX order book (not HOXO orderbook)",tradable:false};
}
function parseCandle(row, nowMs){
  const t=Number(row?.timestamp);
  if(!Number.isSafeInteger(t)||t<0||t>nowMs+60000)throw Error("Invalid trade aggregation timestamp");
  const fields=["open","high","low","close","base_volume","counter_volume"];
  const [o,h,l,c,base,quote]=fields.map(field=>decimalPositive(row[field]));
  if(l>o||l>c||h<o||h<c||l>h)throw Error("Inconsistent OHLC data");
  const count=Number(row.trade_count);
  if(!Number.isSafeInteger(count)||count<1)throw Error("Invalid candle trade count");
  return {timestamp:t,open:o,high:h,low:l,close:c,baseVolume:base,quoteVolume:quote,trades:count};
}
export function normalizeCandles(rows,interval,nowMs=Date.now()){
  const config=PERIODS[interval];
  if(!config)throw Error("Unsupported chart period");
  if(!Array.isArray(rows))throw Error("Missing Horizon trade aggregation records");
  const seen=new Set(),groups=new Map();
  for(const row of rows){
    const c=parseCandle(row,nowMs);
    if(c.timestamp%config.resolution!==0)throw Error("Candle timestamp is not aligned");
    if(seen.has(c.timestamp))throw Error("Duplicate candle aggregation");
    seen.add(c.timestamp);
    const bucket=Math.floor(c.timestamp/config.period)*config.period;
    const group=groups.get(bucket);
    if(group){
      group.high=group.high>c.high?group.high:c.high;
      group.low=group.low<c.low?group.low:c.low;
      if(c.timestamp<group.first){group.first=c.timestamp;group.open=c.open;}
      if(c.timestamp>group.last){group.last=c.timestamp;group.close=c.close;}
      group.baseVolume+=c.baseVolume;group.quoteVolume+=c.quoteVolume;group.trades+=c.trades;
    }else groups.set(bucket,{...c,timestamp:bucket,first:c.timestamp,last:c.timestamp});
  }
  return [...groups.values()].sort((a,b)=>a.timestamp-b.timestamp).map(x=>({
    timestamp:x.timestamp,open:toFixed(x.open),high:toFixed(x.high),low:toFixed(x.low),
    close:toFixed(x.close),baseVolume:toFixed(x.baseVolume),
    quoteVolume:toFixed(x.quoteVolume),trades:x.trades,
    source:"Stellar Horizon Testnet trade aggregation",tradable:false
  }));
}
export async function loadPairMarketData({registry,marketId,interval="30m",...options}={}){
  const config=PERIODS[interval];
  if(!config)return err("unconfigured","Unsupported chart interval");
  let pair;
  try{pair=configuredPair(registry,marketId);}
  catch(e){return err("unconfigured","Market registry rejected: "+String(e.message||e));}
  if(!pair)return err("unconfigured","No verified Testnet issuer/asset pair configured. Real price, candles and book are unavailable.");
  return verifiedRequest(async ctx=>{
    const params=queryPair(pair);
    // Horizon /order_book uses base_asset_* and counter_asset_*.
    // "selling_asset_*/buying_asset_*" are offer fields, NOT this API.
    const bookParams=queryPair(pair);
    bookParams.set("limit","20");
    const windowEnd=Math.floor(ctx.nowMs/config.resolution)*config.resolution;
    const windowStart=windowEnd-config.window;
    const candlesParams=queryPair(pair);
    for(const [k,v] of Object.entries({
      start_time:String(windowStart),end_time:String(windowEnd),
      resolution:String(config.resolution),order:"asc",limit:"200"
    }))candlesParams.set(k,v);
    const [rawBook,rawCandles]=await Promise.all([
      apiGet("/order_book?"+bookParams.toString(),ctx),
      apiGet("/trade_aggregations?"+candlesParams.toString(),ctx)
    ]);
    const book=normalizeOrderBook(rawBook,pair);
    const candles=normalizeCandles(rawCandles?._embedded?.records,interval,ctx.nowMs);
    return {
      state:book.bids.length||book.asks.length||candles.length?"observed":"empty",
      source:MARKET_DATA_SOURCE,ledger:ctx.ledger,pair,book,candles,
      // Prices from Classic SDEX are INDICATIVE; not approved as risk index/mark prices.
      price:book.mid,tradable:false,
      message:"Observed Classic Stellar SDEX data for an explicitly configured Testnet asset pair; NOT Hoxo execution, liquidity or oracle pricing."
    };
  },options);
}
