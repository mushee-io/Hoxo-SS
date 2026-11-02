/**
 * Hoxo M63 — real, one-wallet Stellar Classic DEX spot quote math.
 * Testnet only. This quotes existing orders, not Hoxo M9 settlements.
 * Never infer or fabricate an executable price when book depth is missing.
 */
export const HORIZON_TESTNET="https://horizon-testnet.stellar.org";
export const USDC_TESTNET_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const TESTNET_NETWORK="Test SDF Network ; September 2015";
export const E7=10_000_000n;
export const MAX_QUOTE_AGE_MS=30_000;
const MAX_INPUT_E7=1_000_000_000_000_000n;
function fail(message){throw Error("Hoxo Testnet Spot: "+message);}
export function parseE7(value,label="amount"){
  if(typeof value!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value))
    fail("enter a valid "+label+" with up to seven decimals");
  const [whole,frac=""]=value.split(".");
  const units=BigInt(whole)*E7+BigInt(frac.padEnd(7,"0")||"0");
  if(units<=0n||units>MAX_INPUT_E7)fail(label+" must be positive and within network bounds");
  return units;
}
export function formatE7(units){
  if(typeof units!=="bigint"||units<0n)fail("invalid fixed-point amount");
  return (units/E7).toString()+"."+(units%E7).toString().padStart(7,"0");
}
const ceil=(num,den)=>(num+den-1n)/den;
export function validateBook(book){
  if(!book||book.base?.asset_type!=="native"||
    book.counter?.asset_type!=="credit_alphanum4"||
    book.counter?.asset_code!=="USDC"||
    book.counter?.asset_issuer!==USDC_TESTNET_ISSUER||
    !Array.isArray(book.asks)||!Array.isArray(book.bids))
    fail("Horizon returned a different network asset pair or malformed order book");
  return book;
}
/**
 * Exact 7-decimal XLM quantity. All math is BigInt and uses Stellar's
 * price_r numerator/denominator; no floating-point slippage or amounts.
 * A marketable swap uses direct path [] so no unreviewed intermediary asset.
 */
export function quoteDirectXlmUsdc({
  side,quantityXlm,book,slippageBps=100,nowMs=Date.now()
}={}){
  if(!["buy","sell"].includes(side))fail("choose BUY or SELL XLM");
  if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)
    fail("slippage must be between 0 and 5 percent");
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)fail("invalid quote timestamp");
  validateBook(book);
  const quantityE7=parseE7(quantityXlm,"XLM quantity");
  let remaining=quantityE7;
  let expectedQuoteE7=0n;
  let filledLevels=0;
  const levels=side==="buy"?book.asks:book.bids;
  for(const level of levels){
    if(remaining===0n)break;
    if(!level||!Number.isSafeInteger(level.price_r?.n)||
      !Number.isSafeInteger(level.price_r?.d)||
      level.price_r.n<=0||level.price_r.d<=0)
      fail("invalid authentic Stellar order-book price");
    const available=parseE7(level.amount,"book depth");
    const take=remaining<available?remaining:available;
    const numerator=take*BigInt(level.price_r.n);
    const denominator=BigInt(level.price_r.d);
    const consideration=side==="buy"?ceil(numerator,denominator):
      numerator/denominator;
    if(consideration===0n)fail("quote rounds to zero USDC");
    expectedQuoteE7+=consideration;
    remaining-=take;
    filledLevels++;
  }
  if(remaining>0n)
    fail("not enough matching Stellar Testnet XLM/USDC liquidity for "+quantityXlm+" XLM");
  if(expectedQuoteE7<=0n)fail("no executable Stellar Testnet book quote");
  const limitQuoteE7=side==="buy"?
    ceil(expectedQuoteE7*BigInt(10000+slippageBps),10000n):
    expectedQuoteE7*BigInt(10000-slippageBps)/10000n;
  if(limitQuoteE7<=0n)fail("quote after slippage is too small");
  return Object.freeze({
    network:"Stellar Testnet",venue:"Stellar Classic DEX",
    side,quantityE7:quantityE7.toString(),quantityXlm:formatE7(quantityE7),
    expectedQuoteE7:expectedQuoteE7.toString(),
    expectedUsdc:formatE7(expectedQuoteE7),
    limitQuoteE7:limitQuoteE7.toString(),
    limitUsdc:formatE7(limitQuoteE7),
    slippageBps,levels:filledLevels,observedAtMs:nowMs,
    route:"DIRECT_ONLY",signed:false,submitted:false,confirmed:false
  });
}
export function verifyQuoteFresh(quote,{side,quantityXlm,nowMs=Date.now()}={}){
  if(!quote||quote.side!==side||quote.quantityE7!==parseE7(quantityXlm,"XLM quantity").toString()||
    !Number.isSafeInteger(quote.observedAtMs)||nowMs<quote.observedAtMs||
    nowMs-quote.observedAtMs>MAX_QUOTE_AGE_MS||
    quote.network!=="Stellar Testnet"||quote.route!=="DIRECT_ONLY")
    fail("quote expired or trade changed; request a fresh quote");
  return true;
}
export function readUsdcBalance(account){
  if(!account||!Array.isArray(account.balances))fail("wallet balance proof unavailable");
  const native=account.balances.find(x=>x.asset_type==="native");
  const token=account.balances.find(x=>x.asset_type==="credit_alphanum4"&&
    x.asset_code==="USDC"&&x.asset_issuer===USDC_TESTNET_ISSUER);
  if(!native)fail("native XLM wallet balance unavailable");
  if(!token)fail("USDC Testnet trustline missing; add the listed issuer in Freighter first");
  if(token.is_authorized!==true)
    fail("USDC Testnet trustline not authorised to trade");
  return Object.freeze({
    xlmE7:parseBalance(native.balance),
    usdcE7:parseBalance(token.balance)
  });
}
function parseBalance(value){
  if(typeof value!=="string"||!/^(?:0|[1-9]\d*)\.\d{7}$/.test(value))
    fail("invalid Horizon seven-decimal balance proof");
  const [major,minor]=value.split(".");
  return BigInt(major)*E7+BigInt(minor);
}
export function assertCapacity({side,quote,balance,account}={}){
  if(!quote||!balance||!["buy","sell"].includes(side)||quote.side!==side)
    fail("missing exact reviewed quote or verified balances");
  const units=BigInt(quote.quantityE7),limit=BigInt(quote.limitQuoteE7);
  if(side==="buy"&&balance.usdcE7<limit)
    fail("insufficient Testnet USDC for the maximum signed BUY cost");
  if(side==="sell"){
    // Strict network reserve: 0.5 XLM per (2 + subentries + sponsored net),
    // plus a fee cushion. Horizon itself enforces the final account reserve.
    // Fail closed on incomplete or malformed Horizon account reserve metadata.
    // Never treat missing subentries or sponsorships as zero: doing so can
    // approve an XLM sale that leaves the wallet below its network reserve.
    const integerField=(name)=>{
      const value=account?.[name];
      if(!Number.isSafeInteger(value)||value<0)
        fail("invalid or missing Horizon account reserve proof: "+name);
      return BigInt(value);
    };
    const sub=integerField("subentry_count");
    const sponsoring=integerField("num_sponsoring");
    const sponsored=integerField("num_sponsored");
    const reserves=2n+sub+sponsoring-sponsored;
    if(reserves<0n)fail("inconsistent Horizon sponsorship reserve proof");
    const minReserve=reserves*5_000_000n+100_000n;
    if(balance.xlmE7-units<minReserve)
      fail("insufficient spendable XLM after Stellar account reserve and fee");
  }
  return true;
}
