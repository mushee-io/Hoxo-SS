/**
 * M69: verified, READ-ONLY Stellar Testnet Classic DEX live top-of-book quotes.
 * These are resting BUY/SELL offers, NOT executed trades, Hoxo M9 fills
 * or synthetic trade candles. Every snapshot must originate from a refreshed
 * official Stellar Testnet Classic DEX book response.
 */
const finitePositive=value=>typeof value==="number"&&
  Number.isFinite(value)&&value>0;
export function checkedM69LiveBook(data,{nowMs=Date.now()}={}){
  if(!data||data.sourceKind!=="stellar-testnet"||
     data.currency!=="USDC"||
     data.executable!==false||data.hoxoFills!==false||
     data.tradeExecutable!==false||data.hoxoSettlementEnabled!==false||
     !Array.isArray(data.bids)||!Array.isArray(data.asks)||
     !Number.isSafeInteger(nowMs))
    throw Error("Unverified Stellar Testnet XLM/USDC offer source");
  const bid=data.bids.reduce((acc,b)=>{
    if(!finitePositive(b.price)||!finitePositive(b.amount))throw Error("Invalid bid depth");
    return Math.max(acc,b.price);
  },0);
  const ask=data.asks.reduce((acc,a)=>{
    if(!finitePositive(a.price)||!finitePositive(a.amount))throw Error("Invalid ask depth");
    return Math.min(acc,a.price);
  },Infinity);
  if(!finitePositive(bid)||!finitePositive(ask)||bid>=ask)
    throw Error("No verified noncrossing two-sided Testnet book");
  const observed=data.observedAtMs;
  if(!Number.isSafeInteger(observed)||observed>nowMs+1000||
     nowMs-observed>25000)
    throw Error("Stale Stellar Testnet order book");
  return Object.freeze({
    bid,ask,mid:(bid+ask)/2,spread:ask-bid,
    timestamp:observed,
    venue:"Stellar Classic DEX",
    executedTrades:0,
    hoxoM9Fills:0,
    source:"Verified live resting orders"
  });
}
export function appendM69Quote(history,quote,{max=45}={}){
  if(!Array.isArray(history)||!quote||
     !Number.isSafeInteger(quote.timestamp)||
     !finitePositive(quote.bid)||!finitePositive(quote.ask)||
     quote.ask<=quote.bid||!Number.isInteger(max)||max<2||max>180)
    throw Error("Invalid price snapshot");
  if(history.length&&quote.timestamp<=history.at(-1).timestamp)return history;
  return [...history,quote].slice(-max);
}
