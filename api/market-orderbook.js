/**
 * M48: public read-only exchange and classic Stellar Testnet order books.
 * No API credentials, no offers created, no trading, no mocked price levels.
 */
import {normalizeM48KrakenDepth,normalizeM48HorizonBook,m48HorizonBookUrl} from "../app/m48-book-data.mjs";

export async function readM48OrderBook({source="kraken",fetchImpl=fetch,nowMs=Date.now()}={}){
  if(source!=="kraken"&&source!=="stellar-testnet")
    throw Error("Unsupported orderbook source");
  const url=source==="kraken"?
    "https://api.kraken.com/0/public/Depth?pair=XLMUSD&count=20":
    m48HorizonBookUrl();
  const response=await fetchImpl(url,{
    method:"GET",headers:{accept:"application/json"},
    signal:AbortSignal.timeout(9000)
  });
  if(!response?.ok)throw Error("Public orderbook source unavailable");
  const payload=await response.json();
  const data=source==="kraken"?
    normalizeM48KrakenDepth(payload):normalizeM48HorizonBook(payload);
  return {
    ...data,observedAtMs:nowMs,
    sourceKind:source,
    orderCount:data.bids.length+data.asks.length,
    note:source==="kraken"?
      "EXTERNAL KRAKEN XLM/USD spot offers, not USDC, Hoxo fills or executable Hoxo liquidity":
      "STELLAR TESTNET CLASSIC DEX offers, not Hoxo M9 orders or executable Hoxo liquidity",
    hoxoSettlementEnabled:false,tradeExecutable:false
  };
}
export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"GET only"});
  }
  const source=req.query?.source??"kraken";
  if(typeof source!=="string"||!["kraken","stellar-testnet"].includes(source))
    return res.status(400).json({error:"Invalid orderbook source"});
  try{
    const book=await readM48OrderBook({source});
    res.setHeader("Cache-Control","public, s-maxage=3, stale-while-revalidate=5");
    return res.status(200).json(book);
  }catch{
    res.setHeader("Cache-Control","no-store");
    return res.status(503).json({
      error:"Public orderbook source unavailable",levelsAvailable:false,
      hoxoSettlementEnabled:false
    });
  }
}
