/**
 * Transparent Stellar Testnet QA execution plan.
 * This is NOT liquidity, organic adoption, Hoxo M9 volume, or price discovery.
 * One independently settled test swap in a 15-minute window at most.
 */
import {parseE7,USDC_TESTNET_ISSUER,quoteDirectXlmUsdc,validateBook,readUsdcBalance,assertCapacity} from "../app/m63-spot-core.mjs";

export const QA_INTERVAL_MS=15*60*1000;
export const QA_XLM_AMOUNT="0.0200000";
export const QA_MAX_QUOTE_USDC="0.0500000";
export const QA_MAX_SLIPPAGE_BPS=200;
export const QA_LABEL="AUTOMATED_TESTNET_QA_NOT_ORGANIC_VOLUME";

function fail(message){throw Error("Hoxo Testnet QA: "+message);}
export function qaWindow(nowMs=Date.now()){
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)fail("invalid clock");
  return Math.floor(nowMs/QA_INTERVAL_MS);
}
export function completedQaThisWindow(ops,{account,nowMs=Date.now()}={}){
  if(!Array.isArray(ops)||!Array.isArray(account?.balances)||!account?.id)
    fail("independent account/operation evidence missing");
  const windowStart=qaWindow(nowMs)*QA_INTERVAL_MS;
  let previous=Infinity;
  if(ops.length>200)fail("operation history truncated");
  for(const o of ops){
    const ts=Date.parse(o.created_at||"");
    if(!Number.isFinite(ts)||ts>nowMs+5000||ts>previous)
      fail("unexpected or unordered Stellar operation history");
    previous=ts;
    if(o.source_account!==account.id)continue;
    if(o.type!=="path_payment_strict_send"&&o.type!=="path_payment_strict_receive")continue;
    if(ts>=windowStart)return true;
  }
  // Horizon is ordered descending. If capped at 200 and all of them are
  // recent, the 15-minute window might have further pages; fail closed.
  if(ops.length===200 && previous>=windowStart)
    fail("insufficient transaction history to prove QA rate limit");
  return false;
}
export function planIndependentQa({side,book,account,nowMs=Date.now()}={}){
  if(side!=="buy"&&side!=="sell")fail("invalid QA side");
  validateBook(book);
  const quote=quoteDirectXlmUsdc({
    side,quantityXlm:QA_XLM_AMOUNT,book,
    slippageBps:QA_MAX_SLIPPAGE_BPS,nowMs
  });
  const expected=BigInt(quote.expectedQuoteE7),limit=BigInt(quote.limitQuoteE7);
  if(expected<5000n||expected>500000n||limit>parseE7(QA_MAX_QUOTE_USDC))
    fail("independent depth outside strict QA 0.0005–0.05 USDC limit");
  // Guard adverse Testnet prices: real but poorly priced liquidity can exist.
  if(limit*100n/BigInt(quote.quantityE7)>100n)
    fail("independent Testnet price outside test bounds");
  const balance=readUsdcBalance(account);
  assertCapacity({side,quote,balance,account});
  return Object.freeze({
    ...quote,qaLabel:QA_LABEL,independentOnly:true,
    cancelOwnOffersBeforeExecution:true,
    assetIssuer:USDC_TESTNET_ISSUER,maxXlmPerTrade:QA_XLM_AMOUNT,
    maxUsdcCost:QA_MAX_QUOTE_USDC,
    window:qaWindow(nowMs),organicUsersAttributed:0,
    hoxoM9VolumeAttributed:"0",signed:false,submitted:false
  });
}
