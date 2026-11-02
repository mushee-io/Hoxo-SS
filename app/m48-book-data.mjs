/**
 * M48 verified read-only order-book parsers.
 *
 * Two INDEPENDENT feeds: real Kraken XLM/USD spot books, and classic
 * Stellar Testnet XLM/Circle-test-USDC offers via Horizon.
 * Neither is a Hoxo M9 order book or executable Hoxo quote.
 */
export const M48_CIRCLE_TEST_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const M48_PAIR="XLM/USD";
const KRAKEN_KEYS=["XXLMZUSD","XLMUSD"];
function fail(s){throw Error("M48 orderbook: "+s);}
function parseDecimal(s,name){
  if(typeof s!=="string"||! /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(s))fail("invalid "+name);
  const n=Number(s);
  if(!Number.isFinite(n)||n<=0||n>1e15)fail("invalid "+name);
  return n;
}
function parseRows(rows,name,type){
  if(!Array.isArray(rows)||rows.length>500)fail("invalid "+name+" levels");
  const out=[];
  for(const row of rows){
    if(type==="kraken"){
      if(!Array.isArray(row)||row.length<3)fail("invalid "+name+" entry");
      const price=parseDecimal(row[0],name+" price");
      const amount=parseDecimal(row[1],name+" size");
      const timestamp=Number(row[2]);
      if(!Number.isFinite(timestamp)||timestamp<=0)fail("invalid "+name+" timestamp");
      out.push({price,amount,total:price*amount,timestamp});
    }else{
      if(!row||typeof row!=="object"||Array.isArray(row))fail("invalid Horizon "+name+" entry");
      const price=parseDecimal(row.price,name+" price");
      const amount=parseDecimal(row.amount,name+" size");
      out.push({price,amount,total:price*amount});
    }
  }
  return out;
}
function normalizeSides(bids,asks,{limit=15}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail("bad depth limit");
  bids.sort((a,b)=>b.price-a.price);
  asks.sort((a,b)=>a.price-b.price);
  return {
    bids:bids.slice(0,limit),
    asks:asks.slice(0,limit),
    spread:bids.length&&asks.length?
      Math.max(0,asks[0].price-bids[0].price):null
  };
}
export function normalizeM48KrakenDepth(doc,opts){
  if(!doc||!Array.isArray(doc.error)||doc.error.length||
      !doc.result||typeof doc.result!=="object")fail("invalid Kraken Depth response");
  const keys=Object.keys(doc.result).filter(k=>KRAKEN_KEYS.includes(k));
  if(keys.length!==1||Object.keys(doc.result).length!==1)
    fail("ambiguous or wrong external market identity");
  const pair=doc.result[keys[0]];
  if(!pair||!Array.isArray(pair.asks)||!Array.isArray(pair.bids))
    fail("invalid XLM/USD orderbook");
  return {
    market:"Kraken XLM/USD",currency:"USD",source:"Kraken",
    executable:false,hoxoFills:false,
    ...normalizeSides(parseRows(pair.bids,"bids","kraken"),
      parseRows(pair.asks,"asks","kraken"),opts)
  };
}
export function normalizeM48HorizonBook(doc,opts){
  if(!doc||typeof doc!=="object"||!Array.isArray(doc.bids)||!Array.isArray(doc.asks))
    fail("invalid Stellar Testnet Horizon book");
  // The endpoint is constructed with the exact base XLM and counter USDC
  // issuer; Horizon includes this identity in every book response.
  const base=doc.base,counter=doc.counter;
  if(!base||base.asset_type!=="native"||!counter||
     counter.asset_type!=="credit_alphanum4"||counter.asset_code!=="USDC"||
     counter.asset_issuer!==M48_CIRCLE_TEST_ISSUER)
    fail("wrong Testnet asset identity");
  return {
    market:"Stellar Testnet XLM/USDC (classic DEX)",
    currency:"USDC",source:"Stellar Horizon Testnet",
    executable:false,hoxoFills:false,
    ...normalizeSides(parseRows(doc.bids,"bids","horizon"),
      parseRows(doc.asks,"asks","horizon"),opts)
  };
}
export function m48HorizonBookUrl(){
  const params=new URLSearchParams({
    selling_asset_type:"native",
    buying_asset_type:"credit_alphanum4",
    buying_asset_code:"USDC",
    buying_asset_issuer:M48_CIRCLE_TEST_ISSUER,
    limit:"20"
  });
  return "https://horizon-testnet.stellar.org/order_book?"+params.toString();
}
