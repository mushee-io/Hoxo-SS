/**
 * Actual Stellar Horizon Classic DEX XLM/USDC trade aggregates.
 * Different venue from Hoxo's Soroban M9. No mock candles, fill
 * extrapolation, interpolation or external Kraken reference prices.
 */
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER} from "./m63-spot-core.mjs";

export const M68_FRAMES=Object.freeze({
  "1m":Object.freeze({resolution:60000,interval:60000,periods:90}),
  "30m":Object.freeze({resolution:900000,interval:1800000,periods:90}),
  "1h":Object.freeze({resolution:3600000,interval:3600000,periods:90}),
  "4h":Object.freeze({resolution:3600000,interval:14400000,periods:48}),
  "1d":Object.freeze({resolution:86400000,interval:86400000,periods:90})
});
export function m68HorizonUrl({frame="30m",nowMs=Date.now()}={}){
  const spec=M68_FRAMES[frame];
  if(!spec||!Number.isSafeInteger(nowMs)||nowMs<=0)
    throw Error("M68: unsupported timeframe or current time");
  const start=Math.floor((nowMs-spec.interval*spec.periods)/spec.resolution)*spec.resolution;
  const end=Math.ceil(nowMs/spec.resolution)*spec.resolution;
  const url=new URL("/trade_aggregations",HORIZON_TESTNET);
  for(const [key,value] of Object.entries({
    base_asset_type:"native",
    counter_asset_type:"credit_alphanum4",
    counter_asset_code:"USDC",
    counter_asset_issuer:USDC_TESTNET_ISSUER,
    resolution:String(spec.resolution),
    start_time:String(start),
    end_time:String(end),
    order:"asc",
    limit:"200"
  }))url.searchParams.set(key,value);
  return url;
}
function integer(value){
  if(typeof value!=="string"&&typeof value!=="number")return null;
  if(!/^\d+$/.test(String(value)))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function price(value){
  if(typeof value!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value))
    return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:null;
}
/**
 * Genuine OHLC rows from Horizon may be sparse. We aggregate only reported
 * intervals and NEVER fill gaps with invented candles or zero volume.
 */
export function m68AggregateCandles(payload,{frame="30m"}={}){
  const spec=M68_FRAMES[frame];
  if(!spec||!payload||!Array.isArray(payload?._embedded?.records))
    throw Error("M68: unsupported or malformed Horizon trade aggregates");
  const records=payload._embedded.records;
  if(records.length>200)throw Error("M68: excessive Horizon records");
  const groups=new Map(),seen=new Set();
  const ordered=records.slice().sort((a,b)=>Number(a?.timestamp)-Number(b?.timestamp));
  for(const raw of ordered){
    const timestamp=integer(raw?.timestamp),count=integer(raw?.trade_count);
    const open=price(raw?.open),high=price(raw?.high),
      low=price(raw?.low),close=price(raw?.close),volume=price(raw?.base_volume);
    if(timestamp===null||count===null||count<1||
      open===null||high===null||low===null||close===null||volume===null||
      low>Math.min(open,close)||high<Math.max(open,close)||high<low||
      timestamp%spec.resolution!==0||seen.has(timestamp))
      throw Error("M68: invalid or duplicated Horizon OHLC record");
    seen.add(timestamp);
    const bucket=Math.floor(timestamp/spec.interval)*spec.interval;
    const prev=groups.get(bucket);
    if(!prev)groups.set(bucket,{time:bucket,open,high,low,close,volume,trades:count});
    else{
      prev.high=Math.max(prev.high,high);
      prev.low=Math.min(prev.low,low);
      prev.close=close;
      prev.volume+=volume;
      prev.trades+=count;
    }
  }
  return [...groups.values()].sort((a,b)=>a.time-b.time).slice(-spec.periods);
}
export async function m68ReadHorizonCandles({frame="30m",nowMs=Date.now(),fetchImpl=fetch}={}){
  const url=m68HorizonUrl({frame,nowMs});
  const response=await fetchImpl(url.href,{
    method:"GET",headers:{accept:"application/json"},
    signal:AbortSignal.timeout(14000),cache:"no-store"
  });
  if(!response?.ok)throw Error("M68: Horizon Testnet candle endpoint unavailable");
  const candles=m68AggregateCandles(await response.json(),{frame});
  return Object.freeze({
    network:"Stellar Testnet",
    venue:"Stellar Classic DEX",
    pair:"XLM/USDC",
    issuer:USDC_TESTNET_ISSUER,
    source:"Official Stellar Horizon Testnet trade_aggregations",
    hoxoM9FillsAttributed:0,
    synthetic:false,
    frame,
    candles
  });
}
