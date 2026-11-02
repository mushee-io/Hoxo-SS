/**
 * M45 manual-price, two-wallet Testnet-only M9 simulation builder.
 * This is bilateral testing, NOT a live quoted market or order matcher.
 * Always simulates first; NEVER signs or broadcasts.
 */
import {Address,Contract,TransactionBuilder,nativeToScVal,inspectAuthEntry,xdr,rpc} from "@stellar/stellar-sdk";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";
import {M44_XLM_SAC,M44_USDC_SAC,reviewM44SourceEnvelope} from "./m44-stellar-xdr-verifier.mjs";
import {M45_CANDIDATE} from "./m45-spot-preflight.mjs";
const SCALE=10_000_000n;
function fail(s){throw Error("M45 simulation: "+s);}
function amountE7(text,label){
  if(typeof text!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(text))
    fail("invalid exact 7-decimal "+label);
  const [whole,part=""]=text.split(".");
  const amount=BigInt(whole)*SCALE+BigInt(part.padEnd(7,"0")||"0");
  if(amount<1n||amount>1_000_000_000_000_000n)fail(label+" out of bounds");
  return amount;
}
function randomId(randomBytes){
  const buf=randomBytes(32);
  if(!(buf instanceof Uint8Array)||buf.length!==32)fail("secure 32-byte randomness required");
  return Array.from(buf,b=>b.toString(16).padStart(2,"0")).join("");
}
export function draftM45BilateralTerms({xlmAmount,usdcAmount,side="sell",ledger,
  randomBytes=(n)=>crypto.getRandomValues(new Uint8Array(n))}){
  if(!["sell","buy"].includes(side))fail("side must be buy or sell XLM from Wallet 1");
  if(!Number.isSafeInteger(ledger)||ledger<1||ledger>0xffffffff-100)fail("verified fresh ledger required");
  const base=amountE7(xlmAmount,"XLM"),quote=amountE7(usdcAmount,"USDC");
  // User-selected manual bilateral price; no data feed or price oracle.
  const numerator=quote*SCALE;
  if(numerator%base!==0n)fail("bilateral price must be exactly representable at 7 decimals");
  const price=numerator/base;
  if(price<1n||price>10_000_000_000_000_000n)fail("price exceeds M9 bounds");
  const ids=[randomId(randomBytes),randomId(randomBytes),randomId(randomBytes)];
  if(new Set(ids).size!==3)fail("match and order IDs must be unique");
  return Object.freeze({
    match_id:ids[0],maker_order_id:ids[1],taker_order_id:ids[2],
    maker:M45_CANDIDATE.maker,taker:M45_CANDIDATE.taker,
    base_token:M44_XLM_SAC,quote_token:M44_USDC_SAC,
    base_amount:base.toString(),quote_amount:quote.toString(),
    maker_side:side==="sell"?0:1,
    maker_limit_e7:price.toString(),taker_limit_e7:price.toString(),
    expires_at_ledger:ledger+20
  });
}
function termsScVal(terms){
  const idKeys=new Set(["match_id","maker_order_id","taker_order_id"]);
  const addressKeys=new Set(["maker","taker","base_token","quote_token"]);
  const amountKeys=new Set(["base_amount","quote_amount","maker_limit_e7","taker_limit_e7"]);
  const fields=Object.entries(terms).map(([key,val])=>{
    let sc;
    if(idKeys.has(key))sc=xdr.ScVal.scvBytes(Uint8Array.from(val.match(/../g),b=>parseInt(b,16)));
    else if(addressKeys.has(key))sc=new Address(val).toScVal();
    else if(amountKeys.has(key))sc=nativeToScVal(BigInt(val),{type:"i128"});
    else sc=xdr.ScVal.scvU32(val);
    return new xdr.ScMapEntry({key:xdr.ScVal.scvSymbol(key),val:sc});
  });
  return xdr.ScVal.scvMap(fields);
}
export async function simulateM45BilateralSpot({
  server,preflight,xlmAmount="0.0100000",usdcAmount="0.0200000",side="sell",
  randomBytes, maxFeeStroops=1000000n
}){
  if(!preflight||preflight.readyForSimulation!==true||preflight.contractPaused!==false||
     preflight.contract!==M9_TESTNET_CONTRACT_ID||preflight.network!=="Stellar Testnet")
    fail("fresh unpaused M9 Testnet proof required for simulation");
  if(!server||typeof server.getAccount!=="function"||typeof server.getLatestLedger!=="function"||
     typeof server.simulateTransaction!=="function")fail("official Stellar read-only RPC required");
  const latest=await server.getLatestLedger();
  const ledger=Number(latest?.sequence);
  if(!Number.isSafeInteger(ledger)||Math.abs(ledger-preflight.ledger)>4)
    fail("RPC ledger moved: run a new preflight");
  const terms=draftM45BilateralTerms({xlmAmount,usdcAmount,side,ledger,randomBytes});
  if(!Array.isArray(preflight.wallets)||preflight.wallets.length!==2||
     preflight.wallets[0].address!==terms.maker||
     preflight.wallets[1].address!==terms.taker)
    fail("exact participant balances from fresh Testnet preflight required");
  const baseFrom=terms.maker_side===0?preflight.wallets[0]:preflight.wallets[1];
  const quoteFrom=terms.maker_side===0?preflight.wallets[1]:preflight.wallets[0];
  const nativeGasReserve=10_000_000n;
  if(BigInt(baseFrom.xlmE7??"0")<BigInt(terms.base_amount)+nativeGasReserve)
    fail("XLM selling wallet lacks funds and native fee reserve");
  if(BigInt(quoteFrom.usdcE7??"0")<BigInt(terms.quote_amount))
    fail("USDC paying wallet lacks exact issuer funds");
  const source=await server.getAccount(terms.maker);
  if(source?.accountId?.()!==terms.maker)fail("RPC returned wrong source account");
  const tx=new TransactionBuilder(source,{
    fee:"1000",networkPassphrase:TESTNET_PASSPHRASE
  }).addOperation(new Contract(M9_TESTNET_CONTRACT_ID).call("settle",termsScVal(terms)))
    .setTimeout(60).build();
  const sim=await server.simulateTransaction(tx);
  if(!rpc.Api.isSimulationSuccess(sim))fail("M9 Soroban simulation failed; no wallet prompt permitted");
  const assembled=rpc.assembleTransaction(tx,sim).build();
  const sourceTxXdr=assembled.toXdr();
  reviewM44SourceEnvelope({sourceTxXdr,expectedTerms:terms,currentLedger:ledger,maxFeeStroops});
  const auth=assembled.operations[0].auth??[];
  const takerEntries=auth.filter(item=>{
    const info=inspectAuthEntry(item);
    return info.address===terms.taker&&["address","addressV2"].includes(info.credentialType)&&!info.signed;
  });
  if(takerEntries.length!==1||auth.length>2)
    fail("simulation must return exactly one unsigned non-source taker auth entry");
  const takerAuthXdr=takerEntries[0].toXdr("base64");
  return Object.freeze({terms,sourceTxXdr,takerAuthXdr,currentLedger:ledger,
    feeStroops:String(assembled.fee),simulated:true,signaturesApplied:false,
    broadcast:false,executionPermitted:false});
}
