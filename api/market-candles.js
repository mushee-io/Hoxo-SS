/**
 * M47 public-only reference market candles proxy. No wallet, no credentials,
 * no signing, no exchange order and no Hoxo Testnet fill claims.
 * Vercel /api/market-candles; only approved Kraken XLM/USD feed and intervals.
 */
import {normalizeKrakenCandles,validateM47Request} from "../app/m47-live-candles.mjs";

export async function getM47ReferenceCandles({
  symbol="XLMUSD",interval="30",fetchImpl=fetch,nowMs=Date.now()
}={}){
  const params=validateM47Request({symbol,interval:String(interval)});
  const url="https://api.kraken.com/0/public/OHLC?pair="+params.symbol+
    "&interval="+params.interval;
  const result=await fetchImpl(url,{
    method:"GET",headers:{accept:"application/json"},
    signal:AbortSignal.timeout(8000)
  });
  if(!result?.ok)throw Error("Kraken market-data HTTP unavailable");
  const response=await result.json();
  const candles=normalizeKrakenCandles(response,{nowSec:nowMs/1000});
  if(candles.length<2)throw Error("No genuine external XLM/USD OHLC candles");
  return {
    source:"Kraken",pair:"XLM/USD",quoteCurrency:"USD",
    venue:"External reference market, NOT Hoxo Testnet",
    interval:params.interval,candles,
    lastCandleTimestamp:candles.at(-1).time,fetchedAt:nowMs,
    executableQuote:false,hoxoTradingEnabled:false,
    verifiedHoxoFills:0
  };
}
export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"GET only"});
  }
  const symbol=req.query?.symbol??"XLMUSD",interval=req.query?.interval??"30";
  if(typeof symbol!=="string"||typeof interval!=="string")
    return res.status(400).json({error:"Invalid market-data arguments"});
  try{
    const data=await getM47ReferenceCandles({symbol,interval});
    res.setHeader("Cache-Control","public, s-maxage=15, stale-while-revalidate=30");
    res.setHeader("Content-Type","application/json");
    return res.status(200).json(data);
  }catch(error){
    const invalid=/M47 candles: (?:only vetted|unsupported)/.test(String(error?.message||""));
    res.setHeader("Cache-Control","no-store");
    return res.status(invalid?400:503).json({
      error:invalid?"Unsupported reference instrument":"Independent market feed unavailable",
      dataAvailable:false,exchangeExecutionAvailable:false
    });
  }
}
