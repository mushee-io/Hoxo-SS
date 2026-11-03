/**
 * M45 manual-price, two-wallet Testnet-only M9 simulation builder.
 * This is bilateral testing, NOT a live quoted market or order matcher.
 * Always simulates first; NEVER signs or broadcasts.
 */
import {Address,Contract,TransactionBuilder,nativeToScVal,inspectAuthEntry,xdr,rpc,StrKey} from "@stellar/stellar-sdk";
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
  maker=M45_CANDIDATE.maker,taker=M45_CANDIDATE.taker,
  randomBytes=(n)=>crypto.getRandomValues(new Uint8Array(n))}){
  if(!["sell","buy"].includes(side))fail("side must be buy or sell XLM from Wallet 1");
  if(!StrKey.isValidEd25519PublicKey(maker??"")||
     !StrKey.isValidEd25519PublicKey(taker??"")||maker===taker)
    fail("two different valid Stellar G-addresses are required");
  if(!Number.isSafeInteger(ledger)||ledger<1||ledger>0xffffffff-100)fail("verified fresh ledger required");
  const base=amountE7(xlmAmount,"XLM"),quote=amountE7(usdcAmount,"USDC");
  // The deployed M9 contract itself enforces amount/price limits.
  // Match size is instead constrained by both parties' verified balances,
  // exact reviewed consideration and a successful Soroban simulation.
  // User-selected manual bilateral price; no data feed or price oracle.
  const numerator=quote*SCALE;
  if(numerator%base!==0n)fail("bilateral price must be exactly representable at 7 decimals");
  const price=numerator/base;
  if(price<1n||price>10_000_000_000_000_000n)fail("price exceeds M9 bounds");
  const ids=[randomId(randomBytes),randomId(randomBytes),randomId(randomBytes)];
  if(new Set(ids).size!==3)fail("match and order IDs must be unique");
  return Object.freeze({
    match_id:ids[0],maker_order_id:ids[1],taker_order_id:ids[2],
    maker,taker,
    base_token:M44_XLM_SAC,quote_token:M44_USDC_SAC,
    base_amount:base.toString(),quote_amount:quote.toString(),
    maker_side:side==="sell"?0:1,
    maker_limit_e7:price.toString(),taker_limit_e7:price.toString(),
    expires_at_ledger:ledger+20
  });
}
/**
 * Review exact seller/buyer funding for both settlement directions.
 * Stellar Horizon balances are advisory preflight; Soroban simulation must
 * still verify actual token contract balances and fees before signature.
 */
export function verifyM51TradeCapacity(preflight,terms){
  if(!terms||![0,1].includes(terms.maker_side)||
     !/^[1-9]\d*$/.test(terms.base_amount??"")||
     !/^[1-9]\d*$/.test(terms.quote_amount??""))
    fail("invalid reviewed settlement amounts/side");
  if(!preflight||!Array.isArray(preflight.wallets)||preflight.wallets.length!==2||
     preflight.wallets[0].address!==terms.maker||
     preflight.wallets[1].address!==terms.taker||
     !preflight.wallets.every(w=>w.trustlineAuthorized===true))
    fail("exact participant balances and authorized issuer from fresh Testnet preflight required");
  const baseFrom=terms.maker_side===0?preflight.wallets[0]:preflight.wallets[1];
  const quoteFrom=terms.maker_side===0?preflight.wallets[1]:preflight.wallets[0];
  const nativeGasReserve=10_000_000n;
  if(!/^(0|[1-9]\d*)$/.test(baseFrom.xlmE7??"")||
     !/^(0|[1-9]\d*)$/.test(quoteFrom.usdcE7??""))
    fail("invalid exact balances from Testnet Horizon");
  if(BigInt(baseFrom.xlmE7)<BigInt(terms.base_amount)+nativeGasReserve)
    fail("XLM selling wallet lacks funds and native reserve");
  if(BigInt(quoteFrom.usdcE7)<BigInt(terms.quote_amount))
    fail("USDC paying wallet lacks exact issuer funds");
  return Object.freeze({
    side:terms.maker_side===0?"SELL_XLM":"BUY_XLM",
    xlmSeller:baseFrom.address,usdcPayer:quoteFrom.address,
    xlmAmountE7:terms.base_amount,usdcAmountE7:terms.quote_amount,
    fundingPreflightOnly:true,executionPermitted:false
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
  // Soroban contracttype structs are ScMap maps and MUST use XDR-canonical
  // lexicographic symbol ordering, not JavaScript object insertion order.
  // Without this, real RPC simulation may reject the contract call even
  // though deterministic unit tests using the same incorrect object pass.
  fields.sort((a,b)=>{
    const left=String(a.key.value),right=String(b.key.value);
    return left<right?-1:left>right?1:0;
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
  if(!Array.isArray(preflight.wallets)||preflight.wallets.length!==2)
    fail("two checked Stellar Testnet counterparties are required");
  const terms=draftM45BilateralTerms({
    xlmAmount,usdcAmount,side,ledger,randomBytes,
    maker:preflight.wallets[0].address,taker:preflight.wallets[1].address
  });
  verifyM51TradeCapacity(preflight,terms);
  const source=await server.getAccount(terms.maker);
  if(source?.accountId?.()!==terms.maker)fail("RPC returned wrong source account");
  const tx=new TransactionBuilder(source,{
    fee:"1000",networkPassphrase:TESTNET_PASSPHRASE
  }).addOperation(new Contract(M9_TESTNET_CONTRACT_ID).call("settle",termsScVal(terms)))
    .setTimeout(60).build();
  const sim=await server.simulateTransaction(tx);
  if(!rpc.Api.isSimulationSuccess(sim)){
    const detail=typeof sim?.error==="string"?
      sim.error.slice(0,750).replace(/[\r\n]+/g," "):"No simulation result from Stellar RPC";
    fail("M9 Soroban simulation failed; no wallet prompt permitted. RPC: "+detail);
  }
  const assembled=rpc.assembleTransaction(tx,sim).build();
  const sourceTxXdr=assembled.toXdr();
  // Preserve the hard fee refusal while exposing bounded, read-only resource
  // diagnostics for investigation. No signatures or broadcasts are attempted.
  const assembledFee=BigInt(assembled.fee);
  if(assembledFee>BigInt(maxFeeStroops)){
    const resourceFee=sim?.minResourceFee==null?"unknown":String(sim.minResourceFee);
    const cpu=sim?.cost?.cpuInsns==null?"unknown":String(sim.cost.cpuInsns);
    const memory=sim?.cost?.memBytes==null?"unknown":String(sim.cost.memBytes);
    fail("assembled Testnet fee exceeds ceiling; feeStroops="+assembledFee+
      " ceilingStroops="+BigInt(maxFeeStroops)+
      " minResourceFee="+resourceFee.slice(0,32)+
      " cpuInsns="+cpu.slice(0,32)+" memBytes="+memory.slice(0,32)+
      "; no signing or broadcast");
  }
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
