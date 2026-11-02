/**
 * M48: public read-only exchange and classic Stellar Testnet order books.
 * No API credentials, no offers created, no trading, no mocked price levels.
 */
import {normalizeM48KrakenDepth,normalizeM48HorizonBook,m48HorizonBookUrl} from "../app/m48-book-data.mjs";
import {validateM49PerpMeta,normalizeM49PerpBook} from "../app/m49-perp-book.mjs";

export async function readM48OrderBook({source="kraken",fetchImpl=fetch,nowMs=Date.now()}={}){
  if(!["kraken","stellar-testnet","hyperliquid-perp"].includes(source))
    throw Error("Unsupported orderbook source");
  if(source==="hyperliquid-perp"){
    // Always check exact XLM symbol against the PERPETUAL universe, not spot.
    // The public POST calls only retrieve data; no orders or credentials.
    const endpoint="https://api.hyperliquid.xyz/info";
    async function read(body){
      const response=await fetchImpl(endpoint,{
        method:"POST",headers:{"content-type":"application/json",accept:"application/json"},
        body:JSON.stringify(body),signal:AbortSignal.timeout(8000)
      });
      if(!response?.ok)throw Error("Hyperliquid perpetual feed unavailable");
      return response.json();
    }
    validateM49PerpMeta(await read({type:"meta"}));
    const book=normalizeM49PerpBook(await read({type:"l2Book",coin:"XLM"}),{nowMs});
    return {...book,orderCount:book.bids.length+book.asks.length};
  }
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
  if(typeof source!=="string"||!["kraken","stellar-testnet","hyperliquid-perp"].includes(source))
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
