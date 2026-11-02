#!/usr/bin/env node
/**
 * ONE-SHOT independent valueless Stellar TESTNET Classic DEX acceptance:
 * - A fresh ephemeral CI test identity, funded with official Friendbot.
 * - Explicit trustline; genuine 10 XLM SELL then 1 XLM BUY against actual offers.
 * - Every signed transaction independently confirmed from Horizon.
 * - No production keys, no user wallet, no secrets printed or persisted.
 * - Not Hoxo M9 settlement or organic user trading volume.
 */
import {Asset,Horizon,Keypair,Networks,Operation,TransactionBuilder}
  from "@stellar/stellar-sdk";
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER,quoteDirectXlmUsdc,
  readUsdcBalance,assertCapacity} from "../app/m63-spot-core.mjs";

if(process.env.HOXO_M63_TESTNET_ACCEPTANCE_ACK!=="RUN_ONE_TIME_VALUELESS_TESTNET_SPOT_PROOF")
  throw Error("one-time Testnet acceptance acknowledgement required");
const testnet=new Horizon.Server(HORIZON_TESTNET);
const wallet=Keypair.random(); // intentionally ephemeral; never printed
const address=wallet.publicKey();
const usdc=new Asset("USDC",USDC_TESTNET_ISSUER);
const xlm=Asset.native();
const proof=[];
const fetchJson=async url=>{
  const response=await fetch(url,{cache:"no-store",headers:{accept:"application/json"}});
  if(!response.ok)throw Error("Stellar Testnet HTTP "+response.status);
  return response.json();
};
async function book(){
  const url=new URL("/order_book",HORIZON_TESTNET);
  url.searchParams.set("selling_asset_type","native");
  url.searchParams.set("buying_asset_type","credit_alphanum4");
  url.searchParams.set("buying_asset_code","USDC");
  url.searchParams.set("buying_asset_issuer",USDC_TESTNET_ISSUER);
  url.searchParams.set("limit","200");
  return fetchJson(url);
}
async function doTx(operation,label){
  const account=await testnet.loadAccount(address);
  const fee=String(await testnet.fetchBaseFee());
  if(!/^[1-9]\d*$/.test(fee)||BigInt(fee)>1_000_000n)
    throw Error("Refusing unverified network fee");
  const tx=new TransactionBuilder(account,{networkPassphrase:Networks.TESTNET,fee})
    .addOperation(operation).setTimeout(120).build();
  tx.sign(wallet);
  const submitted=await testnet.submitTransaction(tx);
  const hash=submitted?.hash;
  const localHash=tx.hash().toString("hex");
  if(!/^[0-9a-f]{64}$/i.test(hash??"")||submitted.successful===false||
     localHash!==hash.toLowerCase())
    throw Error(label+" signed transaction receipt check failed: "+
      JSON.stringify({hasHash:/^[a-f0-9]{64}$/i.test(hash??""),
        sameHash:typeof hash==="string"&&localHash===hash.toLowerCase(),
        successful:submitted.successful??null,
        status:submitted.status??null,
        responseKeys:Object.keys(submitted||{}).sort()}));
  const confirmed=await fetchJson(HORIZON_TESTNET+"/transactions/"+hash);
  if(confirmed.successful!==true||confirmed.hash?.toLowerCase()!==hash.toLowerCase()||
     !Number.isSafeInteger(confirmed.ledger)||confirmed.ledger<1)
    throw Error(label+" independent Horizon confirmation failed");
  proof.push({step:label,transactionHash:hash.toLowerCase(),ledger:confirmed.ledger,
    successful:true,explorer:"https://stellar.expert/explorer/testnet/tx/"+hash.toLowerCase()});
  return confirmed;
}
async function run(){
  const horizonRoot=await fetchJson(HORIZON_TESTNET+"/");
  if(horizonRoot.network_passphrase!==Networks.TESTNET)
    throw Error("wrong network at official Horizon");
  // One-time Testnet public Friendbot request to create an ephemeral account.
  const fund=await fetch("https://friendbot.stellar.org/?addr="+encodeURIComponent(address));
  if(!fund.ok)throw Error("official Friendbot refused fresh ephemeral test account: "+fund.status);
  await testnet.loadAccount(address); // independently confirm account exists
  await doTx(Operation.changeTrust({asset:usdc}),"USDC_TRUSTLINE");
  const before=await testnet.loadAccount(address);
  if(!before.balances.some(b=>b.asset_code==="USDC"&&b.asset_issuer===USDC_TESTNET_ISSUER))
    throw Error("Testnet USDC trustline missing after successful tx");
  const sell=quoteDirectXlmUsdc({
    side:"sell",quantityXlm:"10",book:await book(),slippageBps:100
  });
  assertCapacity({side:"sell",quote:sell,balance:readUsdcBalance(before),account:before});
  await doTx(Operation.pathPaymentStrictSend({
    sendAsset:xlm,sendAmount:sell.quantityXlm,
    destination:address,destAsset:usdc,destMin:sell.limitUsdc,path:[]
  }),"SELL_10_XLM_FOR_USDC");
  const afterSell=await testnet.loadAccount(address);
  const sellBalances=readUsdcBalance(afterSell);
  if(sellBalances.usdcE7<=0n)throw Error("SELL did not deliver genuine Testnet USDC");
  const buy=quoteDirectXlmUsdc({
    side:"buy",quantityXlm:"1",book:await book(),slippageBps:100
  });
  assertCapacity({side:"buy",quote:buy,balance:sellBalances,account:afterSell});
  await doTx(Operation.pathPaymentStrictReceive({
    sendAsset:usdc,sendMax:buy.limitUsdc,
    destination:address,destAsset:xlm,destAmount:buy.quantityXlm,path:[]
  }),"BUY_1_XLM_WITH_USDC");
  const afterBuy=readUsdcBalance(await testnet.loadAccount(address));
  if(afterBuy.usdcE7>=sellBalances.usdcE7)
    throw Error("BUY did not spend Testnet USDC");
  return {
    network:"Stellar Testnet",
    status:"TWO_REAL_CLASSIC_DEX_SWAPS_CONFIRMED",
    venue:"Stellar Classic DEX",
    hoxoM9Settlements:0,
    organicUserTradesClaimed:0,
    ephemeralAccount:address,
    proof,
    allProofsSuccessful:proof.length===3&&proof.every(x=>x.successful),
    signatureType:"ephemeral CI signing only; Freighter browser acceptance is a separate check"
  };
}
try{console.log(JSON.stringify(await run(),null,2));}
catch(error){console.error("ONE_SHOT_TESTNET_SPOT_PROOF_FAILED: "+String(error?.message||error));process.exitCode=1;}
