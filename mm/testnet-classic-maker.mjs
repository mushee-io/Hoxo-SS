/**
 * Hoxo Stellar TESTNET Classic DEX two-sided market maker — pure quote planner.
 * No signing, transmission, fabricated fills, or leverage in this module.
 * Independent *external USD* reference is only a pricing input; the actual
 * valueless Testnet USDC offer is a separate on-chain asset.
 */
import {E7,USDC_TESTNET_ISSUER,parseE7,formatE7} from "../app/m63-spot-core.mjs";

const BPS=10000n,ONE=E7;
function fail(message){throw Error("Hoxo Testnet MM: "+message);}
const min=(a,b)=>a<b?a:b;
const max=(a,b)=>a>b?a:b;
const ceil=(n,d)=>(n+d-1n)/d;
function priceInput(value){
  if(typeof value!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value))
    fail("invalid external reference price");
  const [whole,frac=""]=value.split(".");
  const units=BigInt(whole)*ONE+BigInt(frac.padEnd(9,"0").slice(0,9))/100n;
  if(units<10_000n||units>10_000_000_000n)
    fail("external XLM/USD price outside conservative 0.001–1000 range");
  return units;
}
function bookPrice(level){
  if(!level)return null;
  const n=level.price_r?.n,d=level.price_r?.d;
  if(!Number.isInteger(n)||!Number.isInteger(d)||n<=0||d<=0)
    fail("invalid Stellar order-book rational price");
  return BigInt(n)*ONE/BigInt(d);
}
export function parseKrakenReference(payload,{nowMs=Date.now()}={}){
  if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    !payload||!Array.isArray(payload.error)||payload.error.length||
    !payload.result||typeof payload.result!=="object")
    fail("unverified external reference response");
  const records=Object.values(payload.result);
  if(records.length!==1||!Array.isArray(records[0]?.b)||
     !Array.isArray(records[0]?.a))fail("missing exact XLM/USD public ticker");
  const bid=priceInput(records[0].b[0]),ask=priceInput(records[0].a[0]);
  if(bid<=0n||ask<=bid||((ask-bid)*BPS/bid)>500n)
    fail("external price crossed or wide; cancelling MM quotes");
  return Object.freeze({
    source:"KRAKEN_PUBLIC_XLMUSD_REFERENCE_ONLY",
    bidE7:bid.toString(),askE7:ask.toString(),
    midE7:((bid+ask)/2n).toString(),observedAtMs:nowMs,
    externalUsdPrice:true,notHoxoTrade:true
  });
}
function checkedInventory(account){
  if(!account||!Array.isArray(account.balances))fail("unverified maker account");
  const native=account.balances.find(x=>x.asset_type==="native");
  const usdc=account.balances.find(x=>x.asset_type==="credit_alphanum4"&&
    x.asset_code==="USDC"&&x.asset_issuer===USDC_TESTNET_ISSUER);
  if(!native||!usdc||usdc.is_authorized!==true)
    fail("maker requires funded native XLM and authorised Circle Testnet USDC trustline");
  let xlm,quote;
  try{xlm=parseE7(native.balance);quote=parseE7(usdc.balance);}
  catch{fail("maker must hold positive, valid seven-decimal XLM and Testnet USDC");}
  const counts=[account.subentry_count??0,account.num_sponsoring??0,
    account.num_sponsored??0];
  if(counts.some(x=>!Number.isSafeInteger(x)||x<0||x>2000))
    fail("invalid reserve counters in Horizon account");
  const [sub,sponsoring,sponsored]=counts;
  // Additional two subentries + 1 XLM reserve cushion. Existing bot offers
  // are cancelled atomically before replacement; extra reserve is conservative.
  const reserveUnits=max(2n,2n+BigInt(sub)+BigInt(sponsoring)-BigInt(sponsored)+2n)
    *5_000_000n+ONE;
  const spendableXlm=max(0n,xlm-reserveUnits);
  const spendableUsdc=max(0n,quote-ONE); // retain 1 Testnet USDC inventory
  return {xlm,quote,spendableXlm,spendableUsdc,reserveUnits};
}
export function planTestnetMaker({
  account,book,reference,sizeXlm="5",maxQuoteUsdc="2",spreadBps=200,
  nowMs=Date.now()
}={}){
  if(!Number.isSafeInteger(nowMs)||nowMs<=0||
     !reference||reference.source!=="KRAKEN_PUBLIC_XLMUSD_REFERENCE_ONLY"||
     !Number.isSafeInteger(reference.observedAtMs)||
     reference.observedAtMs>nowMs||
     nowMs-reference.observedAtMs>30000)
    fail("no fresh independent external XLM/USD reference");
  if(!Number.isSafeInteger(spreadBps)||spreadBps<50||spreadBps>1000)
    fail("spread must be 50–1000 bps");
  if(!book||book.base?.asset_type!=="native"||
    book.counter?.asset_type!=="credit_alphanum4"||
    book.counter?.asset_code!=="USDC"||
    book.counter?.asset_issuer!==USDC_TESTNET_ISSUER||
    !Array.isArray(book.bids)||!Array.isArray(book.asks))
    fail("wrong Testnet XLM/USDC order book");
  const inv=checkedInventory(account);
  const mid=BigInt(reference.midE7);
  if(mid<=0n)fail("reference cannot be zero");
  const half=BigInt(Math.ceil(spreadBps/2));
  let bid=mid*(BPS-half)/BPS;
  let ask=ceil(mid*(BPS+half),BPS);
  // Prevent any new offer from immediately taking market liquidity. If a
  // book level comes from the same maker, this is conservative and still
  // cannot cross the maker's own outstanding offer.
  const bestAsk=bookPrice(book.asks[0]),bestBid=bookPrice(book.bids[0]);
  const tick=max(1n,mid/100000n);
  if(bestAsk!==null&&bid>=bestAsk)bid=bestAsk-tick;
  if(bestBid!==null&&ask<=bestBid)ask=bestBid+tick;
  if(bid<=0n||ask<=bid||ask>2147483647n||bid>2147483647n)
    fail("invalid/crossed price or Stellar XDR rational range");
  // Never quote >25% away from external mid due to spoofed Testnet offers.
  if((mid>bid?mid-bid:bid-mid)*BPS/mid>2500n||
     (ask>mid?ask-mid:mid-ask)*BPS/mid>2500n)
    fail("Testnet order book distorted >25% from independent reference");
  const size=parseE7(sizeXlm,"order XLM size");
  const cap=parseE7(maxQuoteUsdc,"maximum USDC per side");
  if(cap>1000n*ONE||size>10000n*ONE)
    fail("configured per-side limits exceed controlled Testnet caps");
  const bidSize=min(size,min(cap,inv.spendableUsdc)*ONE/bid);
  const askSize=min(size,min(inv.spendableXlm,cap*ONE/ask));
  if(bidSize<=0n||askSize<=0n)
    fail("insufficient free XLM/USDC inventory for both sides; no offers sent");
  const bidSpend=bidSize*bid/ONE; // sell USDC to buy XLM
  const askReceive=ceil(askSize*ask,ONE);
  if(bidSpend<=0n||bidSpend>cap||bidSpend>inv.spendableUsdc||
     askReceive<=0n||askReceive>cap||askSize>inv.spendableXlm)
    fail("budget exceeded or quote rounded to zero");
  const bidOffer=Object.freeze({
    side:"BID",selling:"USDC",buying:"XLM",
    amount:formatE7(bidSpend),price:Object.freeze({n:10000000,d:Number(bid)}),
    displayPriceUsdc:formatE7(bid),baseSizeXlm:formatE7(bidSize)
  });
  const askOffer=Object.freeze({
    side:"ASK",selling:"XLM",buying:"USDC",
    amount:formatE7(askSize),price:Object.freeze({n:Number(ask),d:10000000}),
    displayPriceUsdc:formatE7(ask),baseSizeXlm:formatE7(askSize)
  });
  return Object.freeze({
    venue:"Stellar Classic DEX",network:"Stellar Testnet",
    referenceSource:reference.source,notHoxoM9:true,
    observedAtMs:reference.observedAtMs,spreadBps,
    inventory:Object.freeze({
      xlm:formatE7(inv.xlm),usdc:formatE7(inv.quote),
      reservedXlm:formatE7(inv.reserveUnits)
    }),
    quotes:Object.freeze([bidOffer,askOffer]),
    containsSignedTransactions:false,
    broadcast:false,verifiedTradeCount:0
  });
}
