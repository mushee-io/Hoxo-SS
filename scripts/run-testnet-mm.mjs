#!/usr/bin/env node
/**
 * Live Stellar Testnet ONLY. This standalone CLI posts *genuine*, passive
 * Classic DEX offers from a dedicated funded maker account.
 *
 * No key in arguments, GitHub, browser, logs or chat. The unattended signer
 * is read solely from process.env.HOXO_MM_SECRET at run time.
 *
 * Modes: plan (default/read-only), live (explicitly armed), stop (cancel).
 * Cron launches one bounded transaction per cycle; it never invents trades.
 */
import {Asset,Horizon,Keypair,Networks,Operation,StrKey,TransactionBuilder}
  from "@stellar/stellar-sdk";
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER} from "../app/m63-spot-core.mjs";
import {parseKrakenReference,planTestnetMaker} from "../mm/testnet-classic-maker.mjs";

const botMode=process.argv[2]||"plan";
const noStore=()=>({headers:{accept:"application/json"},cache:"no-store",
  signal:AbortSignal.timeout(12000)});
const XLM=Asset.native(),USDC=new Asset("USDC",USDC_TESTNET_ISSUER);
const server=new Horizon.Server(HORIZON_TESTNET);
const fail=message=>{throw Error("Hoxo MM: "+message);};
function limitedPositiveInt(raw,defaultValue,min,max,label){
  const value=raw??String(defaultValue);
  if(!/^\d+$/.test(value))fail(label+" must be a positive integer");
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)
    fail(label+" outside supported range "+min+"–"+max);
  return n;
}
async function json(url){
  const res=await fetch(url,noStore());
  if(!res.ok)fail("public market endpoint unavailable: HTTP "+res.status);
  const parsed=await res.json();
  if(!parsed||typeof parsed!=="object")fail("malformed public market response");
  return {data:parsed,headers:res.headers};
}
function offerSide(o){
  const native=a=>a?.asset_type==="native";
  const usd=a=>a?.asset_type==="credit_alphanum4"&&a?.asset_code==="USDC"&&
    a?.asset_issuer===USDC_TESTNET_ISSUER;
  if(native(o.selling)&&usd(o.buying))return "ASK";
  if(usd(o.selling)&&native(o.buying))return "BID";
  return null;
}
async function currentOffers(publicKey){
  const url=new URL("/accounts/"+publicKey+"/offers",HORIZON_TESTNET);
  url.searchParams.set("limit","200");
  const {data}=await json(url);
  const records=data?._embedded?.records;
  if(!Array.isArray(records)||records.length>2)
    fail("maker must have no unrelated offers; use a dedicated MM account");
  const seen=new Set();
  for(const o of records){
    const side=offerSide(o);
    if(!side||seen.has(side)||o.seller!==publicKey||
       !/^[1-9]\d{0,19}$/.test(String(o.id)))
      fail("unexpected offer ownership, asset, or duplicate side; refusing to modify");
    seen.add(side);
  }
  return records;
}
async function verifyNetwork(){
  const {data}=await json(HORIZON_TESTNET);
  if(data.network_passphrase!==Networks.TESTNET)
    fail("Horizon network is not Stellar TESTNET; no signing");
}
async function publicBook(){
  const url=new URL("/order_book",HORIZON_TESTNET);
  for(const [k,v]of Object.entries({
    selling_asset_type:"native",buying_asset_type:"credit_alphanum4",
    buying_asset_code:"USDC",buying_asset_issuer:USDC_TESTNET_ISSUER,
    limit:"10"
  }))url.searchParams.set(k,v);
  return (await json(url)).data;
}
async function referenceTicker(){
  // Operational-only independent reference (not a Hoxo market chart or oracle).
  const url="https://api.kraken.com/0/public/Ticker?pair=XLMUSD";
  const {data,headers}=await json(url);
  const date=headers.get("date");
  if(!date||!Number.isFinite(Date.parse(date))||
    Math.abs(Date.now()-Date.parse(date))>60000)
    fail("external ticker HTTP Date missing/stale");
  return parseKrakenReference(data);
}
function cancellationOperations(offers){
  return offers.map(o=>Operation.manageSellOffer({
    selling:offerSide(o)==="ASK"?XLM:USDC,
    buying:offerSide(o)==="ASK"?USDC:XLM,
    amount:"0",price:"1",offerId:String(o.id)
  }));
}
async function signAndSubmit({signer,ops,mode,preview}){
  if(!Array.isArray(ops)||ops.length<1||ops.length>4)
    fail("unexpected number of maker operations");
  await verifyNetwork();
  const account=await server.loadAccount(signer.publicKey());
  const fee=String(await server.fetchBaseFee());
  if(!/^[1-9]\d*$/.test(fee)||BigInt(fee)>1000000n)
    fail("unexpected Stellar base fee");
  const txb=new TransactionBuilder(account,{
    fee,networkPassphrase:Networks.TESTNET
  });
  for(const op of ops)txb.addOperation(op);
  const tx=txb.setTimeout(45).build();
  // signer must match the actual Horizon account (no server custody of users).
  if(tx.source!==signer.publicKey())fail("unexpected maker transaction source");
  tx.sign(signer);
  if(tx.signatures.length!==1)fail("unexpected signer set");
  console.log(JSON.stringify({
    action:mode,mode:"STELLAR_TESTNET_CLASSIC_DEX",
    account:signer.publicKey(),operations:ops.length,
    expected:preview??null,transactionHash:Buffer.from(tx.hash()).toString("hex")
  }));
  const res=await server.submitTransaction(tx);
  if(res?.successful===false||!(/^[a-fA-F0-9]{64}$/).test(res?.hash??""))
    fail("network did not return successful transaction hash");
  // Horizon submit reports accept/failure; independently verify this hash.
  const check=await json(HORIZON_TESTNET+"/transactions/"+res.hash);
  if(check.data.hash?.toLowerCase()!==res.hash.toLowerCase()||
    check.data.successful!==true||
    !Number.isSafeInteger(check.data.ledger)||check.data.ledger<=0)
    fail("submitted transaction not independently confirmed: "+res.hash);
  console.log(JSON.stringify({
    status:"CONFIRMED",network:"Stellar Testnet",venue:"Stellar Classic DEX",
    transactionHash:res.hash,ledger:check.data.ledger,
    explorer:"https://stellar.expert/explorer/testnet/tx/"+res.hash,
    claimedHoxoM9Trades:0,claimedHoxoM9Volume:"0"
  }));
}
async function main(){
  if(!["plan","live","stop"].includes(botMode))fail("mode must be plan, live or stop");
  const armed=process.env.HOXO_MM_LIVE==="YES";
  if(botMode==="live"&&!armed){
    console.log("MM disarmed: set GitHub Actions variable HOXO_MM_LIVE=YES to enable scheduled execution.");
    return;
  }
  const secret=process.env.HOXO_MM_SECRET;
  let signer;
  if(secret)try{signer=Keypair.fromSecret(secret);}
  catch{fail("signer secret is invalid (never paste it in logs or chat)");}
  let accountAddress=process.env.HOXO_MM_PUBLIC_KEY?.trim()||signer?.publicKey();
  if(!StrKey.isValidEd25519PublicKey(accountAddress??"")){
    if(botMode==="plan"){
      console.log("Read-only MM plan not started: set a public Testnet G-address in HOXO_MM_PUBLIC_KEY.");
      return;
    }
    fail("maker public G-address not configured");
  }
  if(signer&&signer.publicKey()!==accountAddress)
    fail("secret and configured public G-address disagree; no signing");
  if(botMode!=="plan"&&!signer)
    fail("unattended offer signing requires HOXO_MM_SECRET set securely (not in GitHub code)");
  await verifyNetwork();
  const prior=await currentOffers(accountAddress);
  if(botMode==="stop"){
    if(!prior.length){
      console.log("STOP: no active managed Testnet offers");
      return;
    }
    return signAndSubmit({signer,ops:cancellationOperations(prior),mode:"STOP",
      preview:{cancelOfferIds:prior.map(o=>o.id)}});
  }
  const account=await server.loadAccount(accountAddress);
  const spreadBps=limitedPositiveInt(process.env.HOXO_MM_SPREAD_BPS,200,50,1000,"spread bps");
  const sizeXlm=process.env.HOXO_MM_SIZE_XLM||"5";
  const maxQuoteUsdc=process.env.HOXO_MM_MAX_USDC||"2";
  let plan;
  try{
    const [reference,book]=await Promise.all([referenceTicker(),publicBook()]);
    plan=planTestnetMaker({
      account,book,reference,sizeXlm,maxQuoteUsdc,spreadBps
    });
  }catch(error){
    // Fails closed: when running live, remove existing controlled offers if
    // independent prices/asset balances fail. No trading on stale quotes.
    if(botMode==="live"&&prior.length){
      console.error("MM quote check failed; cancelling existing quotes rather than refreshing.");
      await signAndSubmit({signer,ops:cancellationOperations(prior),
        mode:"FAIL_CLOSED_STOP",preview:{cancelOfferIds:prior.map(o=>o.id)}});
    }
    throw error;
  }
  console.log(JSON.stringify({
    status:botMode==="live"?"READY_TO_SUBMIT":"PLAN_ONLY",
    account:accountAddress,network:plan.network,venue:plan.venue,
    priceSource:plan.referenceSource,quoteParameters:plan.quotes,
    existingOfferCount:prior.length,
    balances:plan.inventory,
    m9VolumeAttributed:false,
    ...(botMode==="plan"?{liveSigningRequired:true}:{} )
  }));
  if(botMode==="plan")return;
  const ops=[...cancellationOperations(prior)];
  for(const quote of plan.quotes){
    ops.push(Operation.manageSellOffer({
      selling:quote.side==="ASK"?XLM:USDC,
      buying:quote.side==="ASK"?USDC:XLM,
      amount:quote.amount,price:quote.price,offerId:"0"
    }));
  }
  await signAndSubmit({
    signer,ops,mode:"REPLACE_PASSIVE_QUOTES",
    preview:{spreadBps,quotes:plan.quotes}
  });
}
main().catch(error=>{
  // Never dump SDK error response objects, HTTP bodies or environment values.
  console.error("MM stopped: "+String(error?.message||"Unknown read-only or signing error"));
  process.exitCode=1;
});
