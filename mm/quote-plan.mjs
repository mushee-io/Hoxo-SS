/**
 * M39: TESTNET-only, two-sided market-making quote PLAN.
 *
 * No private keys, wallet signing, orders, trade transmission, volume metrics
 * or on-chain trading are performed by this module. An untrusted manual mark
 * must never be presented as a verified oracle or executable quote.
 *
 * Volume means actual independently signed and finalized trades ONLY.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {SANDBOX_MARKETS,decimalUnits,formatUnits} from "../matching/core.mjs";

const SCALE=10_000_000n,BPS=10_000n;
const MAX_PRICE=1_000_000_000_000_000n;
const MAX_SIZE=1_000_000_000_000n;
const fail=message=>{throw Error("M39 maker: "+message);};
const asData=(value,required)=>{
  if(value===null||typeof value!=="object"||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype)
    fail("plain quote configuration required");
  const keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=="string"||!required.includes(k))||
     keys.length!==required.length)fail("unexpected or missing quote configuration property");
  const clean={};
  for(const k of required){
    const desc=Object.getOwnPropertyDescriptor(value,k);
    if(!desc||!Object.hasOwn(desc,"value"))fail("accessor-backed quote fields forbidden");
    clean[k]=desc.value;
  }
  return clean;
};
function nonneg(value,label){
  if(value==="0")return 0n;
  try{return decimalUnits(value);}
  catch{fail("invalid "+label+" 7-decimal amount");}
}
function positive(value,label,max){
  const n=nonneg(value,label);
  if(n<=0n||n>max)fail(label+" must be positive and bounded");
  return n;
}
function ceilDiv(n,d){return (n+d-1n)/d;}
function nonnegativeAmount(n,label){
  if(n<0n)fail("negative calculated "+label);
  return formatUnits(n);
}
const required=["networkPassphrase","makerPublicKey","marketId",
  "referencePrice","observedAtMs","nowMs","spreadBps",
  "sizeBase","freeBase","freeQuote","maxQuoteNotional","inventoryReserveBps"];
/**
 * Both side quotes must be independently funded, never netted against each
 * other. The maker must be an external *authorized* signer if ever executed.
 * This function cannot produce a Stellar transaction, matching-engine command
 * signature, fake trade receipt, or wash-trading instruction.
 */
export function prepareTestnetMakerQuotePlan(options){
  const cfg=asData(options,required);
  if(cfg.networkPassphrase!==TESTNET_PASSPHRASE)
    fail("canonical Stellar Testnet only");
  if(!isStellarGAddress(cfg.makerPublicKey))
    fail("valid public maker G-address required");
  if(!SANDBOX_MARKETS.includes(cfg.marketId))
    fail("unknown non-deployed reference market");
  if(!Number.isSafeInteger(cfg.nowMs)||cfg.nowMs<=0||
    !Number.isSafeInteger(cfg.observedAtMs)||cfg.observedAtMs<=0||
    cfg.observedAtMs>cfg.nowMs||cfg.nowMs-cfg.observedAtMs>30_000)
    fail("stale, future, or invalid reference price time");
  if(!Number.isSafeInteger(cfg.spreadBps)||cfg.spreadBps<10||cfg.spreadBps>1000)
    fail("spreadBps must be 10..1000 basis points");
  if(!Number.isSafeInteger(cfg.inventoryReserveBps)||
    cfg.inventoryReserveBps<1000||cfg.inventoryReserveBps>9000)
    fail("inventoryReserveBps must be 1000..9000");
  const reference=positive(cfg.referencePrice,"referencePrice",MAX_PRICE);
  const size=positive(cfg.sizeBase,"sizeBase",MAX_SIZE);
  const freeBase=nonneg(cfg.freeBase,"freeBase");
  const freeQuote=nonneg(cfg.freeQuote,"freeQuote");
  const maxNotional=positive(cfg.maxQuoteNotional,"maxQuoteNotional",MAX_PRICE);
  const halfSpread=BigInt(cfg.spreadBps)/2n;
  const bid=reference*(BPS-halfSpread)/BPS;
  const ask=ceilDiv(reference*(BPS+halfSpread),BPS);
  if(bid<=0n||bid>=ask)fail("bid/ask crossed or tick too small");
  const buyCost=ceilDiv(bid*size,SCALE);
  const maxBuyCost=ceilDiv(ask*size,SCALE);
  const availableFraction=BPS-BigInt(cfg.inventoryReserveBps);
  if(buyCost>freeQuote*availableFraction/BPS)
    fail("insufficient unreserved quote inventory for bid");
  if(size>freeBase*availableFraction/BPS)
    fail("insufficient unreserved base inventory for ask");
  if(maxBuyCost>maxNotional)
    fail("maker quote notional exceeds policy");
  const type=cfg.marketId.endsWith("-perp")?"PERPETUAL":"SPOT";
  const quotes=Object.freeze([
    Object.freeze({side:"buy",price:nonnegativeAmount(bid,"bid"),
      sizeBase:nonnegativeAmount(size,"bid size"),maxQuoteDebit:nonnegativeAmount(buyCost,"bid debit")}),
    Object.freeze({side:"sell",price:nonnegativeAmount(ask,"ask"),
      sizeBase:nonnegativeAmount(size,"ask size"),maxBaseDebit:nonnegativeAmount(size,"ask debit")})
  ]);
  return Object.freeze({
    network:"Stellar Testnet",networkPassphrase:TESTNET_PASSPHRASE,
    marketId:cfg.marketId,marketType:type,makerPublicKey:cfg.makerPublicKey,
    referencePrice:cfg.referencePrice,referenceObservedAtMs:cfg.observedAtMs,
    referenceVerifiedByChain:false,source:"CALLER_SUPPLIED_REFERENCE_PRICE_NOT_AUTHENTICATED",
    quotes,
    quotesSigned:false,quotesSubmitted:false,ordersPlaced:false,
    confirmedTrades:0,confirmedVolumeE7:"0",
    washTradingPermitted:false,selfMatchingPermitted:false,
    executionPermitted:false,financialBetaApproved:false,
    marketContractsVerified:false,
    blocker:type==="PERPETUAL"
      ?"Deployed canonical oracle, signed risk approval, escrow and position settlement not independently proven"
      :"Actual deployed M9 spot contract, two-party signatures, settled test token and transaction receipts not independently proven",
    nextAction:"Use separately reviewed on-chain data, wallets and verified contracts; obtain independent maker/taker consent and real signed receipts before reporting any volume",
  });
}
