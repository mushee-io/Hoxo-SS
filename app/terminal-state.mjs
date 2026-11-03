/**
 * Non-deployed reference instruments; NOT token listings, executable books, oracles or contracts.
 */
export const REFERENCE_MARKETS=Object.freeze([
  Object.freeze({id:"xlm-usdc-spot",label:"XLM/USDC",base:"XLM",quote:"USDC",type:"spot",description:"Stellar / spot reference"}),
  Object.freeze({id:"btc-usdc-spot",label:"BTC/USDC",base:"BTC",quote:"USDC",type:"spot",description:"Bitcoin / spot reference"}),
  Object.freeze({id:"xlm-usdc-perp",label:"XLM-PERP",base:"XLM",quote:"USDC",type:"perp",description:"Stellar / perpetual reference"}),
  Object.freeze({id:"btc-usdc-perp",label:"BTC-PERP",base:"BTC",quote:"USDC",type:"perp",description:"Bitcoin / perpetual reference"}),
  Object.freeze({id:"eth-usdc-perp",label:"ETH-PERP",base:"ETH",quote:"USDC",type:"perp",description:"Ether / perpetual reference"})
]);
export const DEFAULT_MARKET_ID="xlm-usdc-spot";
export function getMarket(id){return REFERENCE_MARKETS.find(m=>m.id===id) ?? REFERENCE_MARKETS[0];}
export function filterMarkets(query="",type="all"){
  const q=String(query).trim().toLowerCase();
  const kind=["all","spot","perp"].includes(type)?type:"all";
  return REFERENCE_MARKETS.filter(m=>(kind==="all"||m.type===kind) && [m.label,m.base,m.quote,m.description,m.type].some(s=>s.toLowerCase().includes(q)));
}
/** Positive fixed-point decimal amount, 7 fractional digits; no floats, exponent or sign. */
export function parseAmount7(v){
  if(typeof v!=="string"||!/^(0|[1-9]\d*)(?:\.\d{1,7})?$/.test(v))return null;
  const [whole,part=""]=v.split(".");
  const units=BigInt(whole)*10_000_000n+BigInt(part.padEnd(7,"0"));
  return units>0n && units<(1n<<63n)?units:null;
}
function format7(units){
  const int=(units/10_000_000n).toString();
  const frac=(units%10_000_000n).toString().padStart(7,"0").replace(/0+$/,"");
  return int+(frac?"."+frac:"");
}
/**
 * Local draft ONLY. Limit notional is derived from user-typed price, not market data.
 * No transaction, order, collateral, margin, position or smart-contract calls.
 */
export function orderDraft({marketId=DEFAULT_MARKET_ID,orderType="Market",size="",limitPrice=""}={}){
  const market=getMarket(marketId);
  const amount=parseAmount7(size);
  if(size==="")return {valid:false,sizeLabel:"—",notional:"—",message:market.id==="xlm-usdc-spot"?
    "Enter an XLM amount, then click GET LIVE BUY/SELL QUOTE to check actual Stellar Testnet liquidity.":
    "Enter a size to prepare a non-executable reference draft."};
  if(amount===null)return {valid:false,sizeLabel:"—",notional:"—",message:"Enter a positive size using up to 7 decimals."};
  const sizeLabel=format7(amount)+" "+market.base;
  if(market.id==="xlm-usdc-spot"&&orderType!=="Limit")return {
    valid:true,sizeLabel,notional:"Live order-book quote after review",
    message:"Click GET LIVE BUY/SELL QUOTE for an executable Stellar Testnet Classic DEX price. No transaction is sent until you approve it in Freighter."
  };
  if(orderType!=="Limit")return {valid:true,sizeLabel,notional:"—",message:"Reference only: trading is not deployed for this market."};
  if(limitPrice==="")return {valid:true,sizeLabel,notional:"—",message:market.id==="xlm-usdc-spot"?
    "Enter the USDC/XLM limit price, then request a fresh Stellar Classic DEX quote.":
    "Enter your own limit price for an input-only estimate. This is not a live quote."};
  const price=parseAmount7(limitPrice);
  if(price===null)return {valid:false,sizeLabel,notional:"—",message:"Limit price must be positive and use up to 7 decimals."};
  const result=amount*price/10_000_000n;
  return {valid:true,sizeLabel,notional:format7(result)+" "+market.quote+" (input only)",message:
    market.id==="xlm-usdc-spot"?"User-entered limit estimate only. Click GET LIVE QUOTE to verify actual market depth and fees; Freighter approval is still required.":
    "Draft estimate only. No live quote, liquidity, margin check or order execution."};
}
