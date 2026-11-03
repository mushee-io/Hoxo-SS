/**
 * Read-only attribution for automated, isolated Hoxo Stellar TESTNET QA fills.
 * Unlike aggregate candle bars, these explicitly distinguish operator test
 * trading from public demand, ordinary Classic DEX trades and Hoxo M9.
 */
import {StrKey} from "@stellar/stellar-sdk";
import {HORIZON_TESTNET} from "../app/m63-spot-core.mjs";

async function get(url){
  const response=await fetch(url,{
    headers:{accept:"application/json"},
    cache:"no-store",signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error("Independent Horizon evidence unavailable");
  return response.json();
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"GET only"});
  }
  const address=process.env.HOXO_MM_PUBLIC_KEY;
  if(!StrKey.isValidEd25519PublicKey(address??""))
    return res.status(503).json({status:"UNCONFIGURED",verified:false});
  try{
    const url=new URL("/accounts/"+address+"/operations",HORIZON_TESTNET);
    url.searchParams.set("order","desc");
    url.searchParams.set("limit","200");
    const operations=(await get(url.href))?._embedded?.records;
    if(!Array.isArray(operations))
      throw Error("Cannot verify public bot operations");
    const candidates=operations.filter(op=>
      op.source_account===address&&
      ["path_payment_strict_send","path_payment_strict_receive"].includes(op.type)
    ).slice(0,4);
    const verified=[];
    for(const op of candidates){
      const hash=op.transaction_hash;
      if(!/^[0-9a-f]{64}$/i.test(hash??""))continue;
      const receipt=await get(HORIZON_TESTNET+"/transactions/"+hash);
      if(receipt.hash?.toLowerCase()!==hash.toLowerCase()||
         receipt.successful!==true||!Number.isSafeInteger(receipt.ledger))
        continue;
      verified.push({
        label:"AUTOMATED_TESTNET_QA_NOT_ORGANIC_VOLUME",
        type:"BOT_GENERATED_TEST_TRADE",
        network:"Stellar Testnet",venue:"Stellar Classic DEX",
        side:op.type==="path_payment_strict_receive"?"BUY":"SELL",
        transactionHash:hash,ledger:receipt.ledger,at:receipt.created_at,
        sourceAccount:address,
        organicUserVolumeAttributed:0,hoxoM9VolumeAttributed:0
      });
    }
    return res.status(200).json({
      status:"VERIFIED",network:"Stellar Testnet",
      source:"Independent Stellar Horizon Testnet",
      note:"Operator-controlled automated testing; not organic user trading",
      publishedSyntheticVolume:false,
      results:verified
    });
  }catch{
    return res.status(503).json({status:"UNAVAILABLE",verified:false});
  }
}
