/**
 * PRICE REVIEW ONLY: read-only independently sourced candidate index and mark.
 * DOES NOT authenticate sources or confer trading permissions. Soroban must
 * verify authenticated on-chain oracle values before any trade or liquidation.
 */
import {parsePositive,toFixed,SCALE} from "./model.mjs";
export const POLICY=Object.freeze({maxAgeMs:120000,independentSources:2,maxDeviationBps:150,maxMarkDeviationBps:250});
const fail=(reason)=>({state:"halted",reason,indexPrice:null,markPrice:null,riskExecutable:false,sourceCount:0});
const abs=n=>n<0n?-n:n;
function bpsDiff(x,y){return abs(x-y)*10000n/y;}
export function reviewOracle(samples,{marketId,nowMs=Date.now(),halt=true,markMid=null}={}){
  if(halt)return fail("Kill switch active: oracle contract not verified.");
  if(!marketId||!Array.isArray(samples))return fail("Missing canonical market or oracle sources");
  const seen=new Set(),prices=[];
  for(const record of samples){
    if(!record||record.marketId!==marketId||typeof record.sourceId!=="string"||!record.sourceId||
       !Number.isSafeInteger(record.timestampMs)||record.timestampMs>nowMs+15000||
       nowMs-record.timestampMs>POLICY.maxAgeMs)return fail("Missing, stale, future or misattributed oracle sample");
    if(seen.has(record.sourceId))return fail("Duplicate oracle source identity");
    seen.add(record.sourceId);
    let price;
    try{price=parsePositive(record.price);}catch{return fail("Malformed oracle sample price");}
    prices.push(price);
  }
  if(prices.length<POLICY.independentSources)return fail("Insufficient independent price observations");
  prices.sort((a,b)=>a<b?-1:a>b?1:0);
  const median=prices.length%2 ? prices[Math.floor(prices.length/2)] :
    (prices[prices.length/2-1]+prices[prices.length/2])/2n;
  if(bpsDiff(prices[prices.length-1],median)>BigInt(POLICY.maxDeviationBps)||
     bpsDiff(prices[0],median)>BigInt(POLICY.maxDeviationBps))return fail("Oracle sources disagree above deviation threshold");
  let markPrice=null;
  if(markMid!==null){
    let mark;
    try{mark=parsePositive(markMid);}catch{return fail("Invalid candidate mark price");}
    if(bpsDiff(mark,median)>BigInt(POLICY.maxMarkDeviationBps))return fail("Mark/index deviation above threshold");
    markPrice=toFixed(mark);
  }
  return {
    state:"candidate-only",
    reason:"Price observations pass mathematical checks but are NOT authenticated on-chain or approved for trade/risk.",
    indexPrice:toFixed(median),markPrice,sourceCount:seen.size,
    riskExecutable:false // hard safety boundary
  };
}
