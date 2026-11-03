/**
 * M70 — transparent, rate-limited QA path payment on Stellar Testnet.
 * Uses the EXISTING isolated maker signer, NEVER the user's Freighter key.
 *
 * Offers from this same account are cancelled before quoting, and a second
 * atomic cancellation precedes the path payment if any new offers appeared.
 * The accounting is labelled bot-generated QA, not organic trading volume.
 */
import {Asset,Horizon,Keypair,Networks,Operation,StrKey,TransactionBuilder}
  from "@stellar/stellar-sdk";
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER,validateBook}
  from "../app/m63-spot-core.mjs";
import {QA_INTERVAL_MS,QA_LABEL,qaWindow,completedQaThisWindow,
  planIndependentQa} from "../mm/m70-transparent-qa.mjs";
import {runTestnetMM} from "./run-testnet-mm.mjs";

const server=new Horizon.Server(HORIZON_TESTNET);
const xlm=Asset.native(),usdc=new Asset("USDC",USDC_TESTNET_ISSUER);
const fail=reason=>{throw Error("Hoxo Testnet QA: "+reason);};
async function publicJson(url){
  const res=await fetch(url,{cache:"no-store",headers:{accept:"application/json"},
    signal:AbortSignal.timeout(12000)});
  if(!res.ok)fail("independent Stellar Horizon verification HTTP "+res.status);
  return res.json();
}
function offersUrl(address){
  const url=new URL("/accounts/"+encodeURIComponent(address)+"/offers",HORIZON_TESTNET);
  url.searchParams.set("limit","200");
  return url.href;
}
function ownSide(offer,address){
  if(!offer||offer.seller!==address||!/^[1-9]\d{0,19}$/.test(String(offer.id)))
    fail("unverified own offer");
  const native=a=>a?.asset_type==="native";
  const token=a=>a?.asset_type==="credit_alphanum4"&&
    a?.asset_code==="USDC"&&a?.asset_issuer===USDC_TESTNET_ISSUER;
  if(native(offer.selling)&&token(offer.buying))return "ask";
  if(token(offer.selling)&&native(offer.buying))return "bid";
  fail("own account includes an unrelated offer; QA cannot modify it");
}
async function ownedOffers(address){
  const result=await publicJson(offersUrl(address));
  const offers=result?._embedded?.records;
  if(!Array.isArray(offers)||offers.length>2)fail("unreviewed maker offers");
  const seen=new Set();
  for(const offer of offers){
    const side=ownSide(offer,address);
    if(seen.has(side))fail("unexpected duplicate maker offer");
    seen.add(side);
  }
  return offers;
}
function cancelOps(offers,address){
  return offers.map(offer=>{
    const side=ownSide(offer,address);
    return Operation.manageSellOffer({
      selling:side==="ask"?xlm:usdc,buying:side==="ask"?usdc:xlm,
      amount:"0",price:"1",offerId:String(offer.id)
    });
  });
}
async function directBook(){
  const url=new URL("/order_book",HORIZON_TESTNET);
  for(const [key,value] of Object.entries({
    selling_asset_type:"native",
    buying_asset_type:"credit_alphanum4",
    buying_asset_code:"USDC",
    buying_asset_issuer:USDC_TESTNET_ISSUER,
    limit:"200"
  }))url.searchParams.set(key,value);
  return validateBook(await publicJson(url.href));
}
async function recentOperations(address){
  const url=new URL("/accounts/"+encodeURIComponent(address)+"/operations",HORIZON_TESTNET);
  url.searchParams.set("order","desc");
  url.searchParams.set("limit","200");
  const data=await publicJson(url.href);
  if(!Array.isArray(data?._embedded?.records))
    fail("cannot independently verify recent automatic QA transactions");
  return data._embedded.records;
}
async function verifiedReceipt(hash,source,side){
  if(!/^[0-9a-f]{64}$/i.test(hash??""))fail("missing network transaction hash");
  const tx=await publicJson(HORIZON_TESTNET+"/transactions/"+hash);
  if(tx?.hash?.toLowerCase()!==hash.toLowerCase()||tx.successful!==true||
     !Number.isSafeInteger(tx.ledger)||tx.ledger<1)
    fail("failed independent Stellar Testnet transaction receipt");
  const ops=await publicJson(HORIZON_TESTNET+"/transactions/"+hash+"/operations?limit=10");
  const records=ops?._embedded?.records;
  if(!Array.isArray(records)||records.length<1||records.length>3)
    fail("on-chain operation evidence unavailable");
  const last=records.at(-1);
  if(last?.source_account!==source||last?.type!==
     (side==="buy"?"path_payment_strict_receive":"path_payment_strict_send"))
    fail("receipt does not prove the expected automated Testnet swap");
  if(last.to!==source)
    fail("QA swap must return the purchased asset to the bot's own Testnet account");
  return Object.freeze({hash,ledger:tx.ledger,at:tx.created_at});
}
export async function runTransparentTestnetQaTrade(){
  if(process.env.HOXO_MM_QA_ENABLED!=="YES"||
     process.env.HOXO_MM_VERCEL_LIVE!=="YES")
    return {status:"DISABLED",label:QA_LABEL};
  const publicKey=process.env.HOXO_MM_PUBLIC_KEY?.trim();
  if(!StrKey.isValidEd25519PublicKey(publicKey??""))
    fail("maker account not configured");
  let signer;
  try{signer=Keypair.fromSecret(process.env.HOXO_MM_SECRET??"");}
  catch{fail("isolated Testnet signer invalid");}
  if(signer.publicKey()!==publicKey)
    fail("isolated QA account does not match the configured signer");
  const root=await publicJson(HORIZON_TESTNET);
  if(root.network_passphrase!==Networks.TESTNET)
    fail("network is not Stellar Testnet");
  const nowMs=Date.now(),window=qaWindow(nowMs);
  const firstAccount=await server.loadAccount(publicKey);
  if(completedQaThisWindow(await recentOperations(publicKey),{
    account:firstAccount,nowMs
  }))return {status:"ALREADY_EXECUTED_THIS_WINDOW",window,label:QA_LABEL};
  // All bot-owned resting offers are CANCELLED AND CONFIRMED first.
  // We do not execute against a book that still contains our own liquidity.
  await runTestnetMM("stop");
  if((await ownedOffers(publicKey)).length)
    fail("own offers still live; no QA transaction permitted");
  const side=window%2===0?"buy":"sell";
  const freshBook=await directBook();
  const account=await server.loadAccount(publicKey);
  const plan=planIndependentQa({side,book:freshBook,account,nowMs:Date.now()});
  const newOffers=await ownedOffers(publicKey);
  // Any concurrent new maker offers are atomically cancelled BEFORE the trade.
  // If a concurrent maker transaction changes the account sequence, this
  // entire transaction fails, rather than risking an unreviewed self-cross.
  const ops=cancelOps(newOffers,publicKey);
  ops.push(side==="buy"?
    Operation.pathPaymentStrictReceive({
      sendAsset:usdc,sendMax:plan.limitUsdc,
      destAsset:xlm,destAmount:plan.quantityXlm,
      destination:publicKey,path:[]
    }):
    Operation.pathPaymentStrictSend({
      sendAsset:xlm,sendAmount:plan.quantityXlm,
      destAsset:usdc,destMin:plan.limitUsdc,
      destination:publicKey,path:[]
    }));
  if(ops.length<1||ops.length>3)fail("unexpected operations in QA transaction");
  const fee=String(await server.fetchBaseFee());
  if(!/^[1-9]\d*$/.test(fee)||BigInt(fee)>1000000n)
    fail("network fee beyond Testnet QA limit");
  // The account snapshot is from before read-own-offers; a concurrent
  // maker refresh will invalidate this transaction's sequence, fail-closed.
  const builder=new TransactionBuilder(account,{
    fee,networkPassphrase:Networks.TESTNET
  });
  for(const op of ops)builder.addOperation(op);
  const tx=builder.setTimeout(45).build();
  if(tx.source!==publicKey||plan.observedAtMs<Date.now()-30000)
    fail("unexpected transaction source or stale independent quote");
  tx.sign(signer);
  const sent=await server.submitTransaction(tx);
  if(sent?.successful===false||!/^[0-9a-f]{64}$/i.test(sent?.hash??""))
    fail("Stellar Testnet did not accept the independent QA trade");
  const confirmed=await verifiedReceipt(sent.hash,publicKey,side);
  console.log(JSON.stringify({
    event:QA_LABEL,status:"CONFIRMED",
    network:"Stellar Testnet",venue:"Stellar Classic DEX",
    side,quantityXlm:plan.quantityXlm,
    transactionHash:confirmed.hash,ledger:confirmed.ledger,
    explorer:"https://stellar.expert/explorer/testnet/tx/"+confirmed.hash,
    automatedTest:true,organicUserVolume:0,hoxoM9Volume:0,
    tradeWindow:window
  }));
  return {status:"CONFIRMED",side,quantityXlm:plan.quantityXlm,
    hash:confirmed.hash,ledger:confirmed.ledger,label:QA_LABEL,
    organicVolumeAttributed:"0",m9VolumeAttributed:"0"};
}
