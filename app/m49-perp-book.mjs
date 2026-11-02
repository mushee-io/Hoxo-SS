/**
 * M49: external Hyperliquid XLM perpetual L2 orderbook.
 *
 * All data is EXTERNAL MAINNET perpetual-market reference liquidity,
 * NEVER Hoxo Stellar Testnet liquidity, orders, margin or executable quotes.
 * Require the exact XLM perp to exist in Hyperliquid's perp "meta" universe;
 * never treat same-symbol spot listings as perps.
 */
const NAME="XLM";
const DECIMAL=/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
function fail(message){throw Error("M49 perpetual book: "+message);}
function amount(value,label){
  if(typeof value!=="string"||!DECIMAL.test(value))fail("invalid "+label);
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||n>1e13)fail("invalid "+label);
  return n;
}
export function validateM49PerpMeta(meta){
  if(!meta||typeof meta!=="object"||!Array.isArray(meta.universe)||
    meta.universe.length<1||meta.universe.length>3000)fail("missing perp universe metadata");
  const matches=meta.universe.filter(item=>item&&typeof item==="object"&&item.name===NAME);
  if(matches.length!==1||matches[0].isDelisted===true)
    fail("XLM is not confirmed as a listed perpetual");
  const item=matches[0];
  if(!Number.isSafeInteger(item.szDecimals)||item.szDecimals<0||item.szDecimals>12)
    fail("malformed listed XLM perp metadata");
  return Object.freeze({coin:NAME,szDecimals:item.szDecimals,listed:true});
}
export function normalizeM49PerpBook(snapshot,{nowMs=Date.now(),limit=15}={}){
  if(!snapshot||snapshot.coin!==NAME||!Array.isArray(snapshot.levels)||
    snapshot.levels.length!==2||!Number.isSafeInteger(snapshot.time)||
    snapshot.time>nowMs+10000||nowMs-snapshot.time>30000||
    !Number.isSafeInteger(limit)||limit<1||limit>20)
    fail("wrong/stale XLM perpetual snapshot");
  const [bidLevels,askLevels]=snapshot.levels;
  if(!Array.isArray(bidLevels)||!Array.isArray(askLevels)||
    bidLevels.length>20||askLevels.length>20)
    fail("malformed perpetual bid/ask levels");
  function levels(rows,side){
    const parsed=rows.map(row=>{
      if(!row||typeof row!=="object"||Array.isArray(row)||
         !Number.isSafeInteger(row.n)||row.n<1)
        fail("invalid "+side+" order count");
      const price=amount(row.px,side+" price");
      const quantity=amount(row.sz,side+" size");
      return {price,amount:quantity,total:price*quantity,orderCount:row.n};
    });
    parsed.sort((a,b)=>side==="bid"?b.price-a.price:a.price-b.price);
    return parsed.slice(0,limit);
  }
  const bids=levels(bidLevels,"bid"),asks=levels(askLevels,"ask");
  if(bids.length&&asks.length&&bids[0].price>=asks[0].price)
    fail("invalid crossed perpetual book");
  return Object.freeze({
    source:"Hyperliquid",sourceKind:"hyperliquid-perp",
    market:"XLM perpetual",marketType:"perpetual",
    quoteCurrency:"USDC",currency:"USDC",externalMainnet:true,
    observedAtMs:snapshot.time,
    bids,asks,spread:bids.length&&asks.length?asks[0].price-bids[0].price:null,
    executable:false,hoxoFills:false,tradeExecutable:false,hoxoSettlementEnabled:false,
    note:"EXTERNAL HYPERLIQUID XLM PERPETUAL · NOT HOXO STELLAR TESTNET ORDERS"
  });
}
