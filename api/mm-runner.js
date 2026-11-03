/**
 * Hoxo isolated TESTNET-only automatic market maker runner.
 * Vercel's CRON_SECRET authenticates scheduling; the seed stays server-side.
 * Bootstrap new dedicated account through Friendbot + a limited real
 * on-chain Testnet Classic DEX XLM -> USDC swap (never M9 fills).
 */
import {timingSafeEqual} from "node:crypto";
import {Asset,Horizon,Keypair,Networks,Operation,TransactionBuilder,StrKey}
  from "@stellar/stellar-sdk";
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER,quoteDirectXlmUsdc}
  from "../app/m63-spot-core.mjs";
import {runTestnetMM} from "../scripts/run-testnet-mm.mjs";
import {runTransparentTestnetQaTrade} from "../scripts/m70-independent-qa-trade.mjs";

export const config={maxDuration:60};
const server=new Horizon.Server(HORIZON_TESTNET);
const XLM=Asset.native(),USDC=new Asset("USDC",USDC_TESTNET_ISSUER);
const fail=reason=>{throw Error("Hoxo MM bootstrap: "+reason);};
function safeAuth(provided,secret){
  if(typeof provided!=="string"||typeof secret!=="string"||secret.length<32)return false;
  const a=Buffer.from(provided),b=Buffer.from("Bearer "+secret);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function fetchJSON(url){
  const response=await fetch(url,{cache:"no-store",
    headers:{accept:"application/json"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)fail("external Testnet service unavailable (HTTP "+response.status+")");
  return response.json();
}
async function verifyNetwork(){
  const root=await fetchJSON(HORIZON_TESTNET);
  if(root.network_passphrase!==Networks.TESTNET)
    fail("only pinned Stellar Testnet is supported");
}
async function confirm(hash){
  if(!/^[a-f0-9]{64}$/i.test(hash??""))fail("missing valid on-chain transaction hash");
  const receipt=await fetchJSON(HORIZON_TESTNET+"/transactions/"+hash);
  if(receipt.hash?.toLowerCase()!==hash.toLowerCase()||
     receipt.successful!==true||!Number.isSafeInteger(receipt.ledger))
    fail("transaction not independently confirmed");
  return {hash,ledger:receipt.ledger};
}
async function submit(signer,operations,label){
  if(operations.length<1||operations.length>2)fail("invalid bootstrap operation set");
  await verifyNetwork();
  const account=await server.loadAccount(signer.publicKey());
  const fee=String(await server.fetchBaseFee());
  if(!/^[1-9]\d*$/.test(fee)||BigInt(fee)>1000000n)
    fail("unexpected Testnet fee");
  const builder=new TransactionBuilder(account,{
    fee,networkPassphrase:Networks.TESTNET
  });
  for(const op of operations)builder.addOperation(op);
  const tx=builder.setTimeout(60).build();
  if(tx.source!==signer.publicKey())fail("incorrect transaction source");
  tx.sign(signer);
  const receipt=await server.submitTransaction(tx);
  if(receipt.successful===false)fail("Testnet bootstrap operation rejected");
  const confirmed=await confirm(receipt.hash);
  console.log(JSON.stringify({
    status:"BOOTSTRAP_CONFIRMED",action:label,network:"Stellar Testnet",
    transactionHash:confirmed.hash,ledger:confirmed.ledger,
    venue:"Stellar Classic DEX",hoxoM9Fills:0
  }));
}
async function bootstrap(signer){
  await verifyNetwork();
  const publicKey=signer.publicKey();
  try{await server.loadAccount(publicKey);}
  catch(error){
    if(error?.response?.status!==404&&error?.response?.data?.status!==404)
      throw error;
    await fetchJSON("https://friendbot.stellar.org/?addr="+encodeURIComponent(publicKey));
    console.log(JSON.stringify({status:"FRIENDBOT_FUNDED",account:publicKey}));
  }
  let account=await server.loadAccount(publicKey);
  const native=account.balances.find(x=>x.asset_type==="native");
  if(!native||Number(native.balance)<70)
    fail("dedicated maker needs at least 70 free Testnet XLM for initial bootstrap and reserves");
  let token=account.balances.find(x=>x.asset_type==="credit_alphanum4"&&
    x.asset_code==="USDC"&&x.asset_issuer===USDC_TESTNET_ISSUER);
  if(token&&token.is_authorized!==true)fail("Testnet USDC trustline not authorized");
  if(!token){
    await submit(signer,[Operation.changeTrust({asset:USDC})],"CIRCLE_USDC_TRUSTLINE");
    account=await server.loadAccount(publicKey);
    token=account.balances.find(x=>x.asset_type==="credit_alphanum4"&&
      x.asset_code==="USDC"&&x.asset_issuer===USDC_TESTNET_ISSUER);
    if(!token||token.is_authorized!==true)fail("Testnet USDC trustline not confirmed");
  }
  if(Number(token.balance)>=2.5)return;
  // Buy real Testnet USDC from existing independent market liquidity;
  // cap initial inventory acquisition at 25 Testnet XLM.
  const url=new URL("/order_book",HORIZON_TESTNET);
  for(const [key,value] of Object.entries({
    selling_asset_type:"native",buying_asset_type:"credit_alphanum4",
    buying_asset_code:"USDC",buying_asset_issuer:USDC_TESTNET_ISSUER,limit:"200"
  }))url.searchParams.set(key,value);
  const book=await fetchJSON(url);
  const quote=quoteDirectXlmUsdc({side:"sell",quantityXlm:"25",book,
    slippageBps:200});
  if(BigInt(quote.limitQuoteE7)<15000000n)
    fail("Insufficient Testnet market bids for safe initial USDC inventory");
  const swap=Operation.pathPaymentStrictSend({
    sendAsset:XLM,sendAmount:"25.0000000",destAsset:USDC,
    destMin:quote.limitUsdc,destination:publicKey,path:[]
  });
  await submit(signer,[swap],"INITIAL_25_XLM_TO_USDC");
  account=await server.loadAccount(publicKey);
  token=account.balances.find(x=>x.asset_type==="credit_alphanum4"&&
    x.asset_code==="USDC"&&x.asset_issuer===USDC_TESTNET_ISSUER);
  if(!token||Number(token.balance)<1.5)
    fail("No confirmed Testnet USDC inventory after bootstrap swap");
}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET")return res.status(405).json({error:"GET only"});
  if(!safeAuth(req.headers.authorization,process.env.CRON_SECRET))
    return res.status(401).json({error:"Unauthorized"});
  if(process.env.HOXO_MM_VERCEL_LIVE!=="YES")
    return res.status(200).json({status:"DISARMED",network:"Stellar Testnet"});
  try{
    const secret=process.env.HOXO_MM_SECRET;
    const address=process.env.HOXO_MM_PUBLIC_KEY;
    if(!secret||!StrKey.isValidEd25519PublicKey(address??""))
      fail("isolated Testnet maker signing configuration incomplete");
    let signer;
    try{signer=Keypair.fromSecret(secret);}
    catch{fail("invalid dedicated signer configuration");}
    if(signer.publicKey()!==address)
      fail("maker signer does not match configured public G-address");
    if(process.env.HOXO_MM_VERCEL_STOP==="YES"){
      await runTestnetMM("stop");
      return res.status(200).json({status:"STOP_REQUESTED",account:address});
    }
    await bootstrap(signer);
    let qa={status:"DISABLED"};
    if(process.env.HOXO_MM_QA_ENABLED==="YES"){
      try{qa=await runTransparentTestnetQaTrade();}
      catch(error){
        // A failed QA test must NEVER misstate a fill or prevent the
        // separate passive liquidity bot from restoring its offers.
        qa={status:"HALTED_NO_CONFIRMED_SWAP"};
        console.error("Isolated QA test not confirmed: "+
          String(error?.message||"unavailable").slice(0,170));
      }
    }
    await runTestnetMM("live");
    return res.status(200).json({
      status:"MM_TICK_COMPLETED",network:"Stellar Testnet",
      account:address,venue:"Stellar Classic DEX",m9VolumeClaimed:false,
      qaStatus:qa.status,
      qaReceipt:qa.status==="CONFIRMED"?{
        transactionHash:qa.hash,ledger:qa.ledger,
        side:qa.side,quantityXlm:qa.quantityXlm,
        label:"AUTOMATED_TESTNET_QA_NOT_ORGANIC_VOLUME"
      }:null
    });
  }catch(error){
    // Never return the signing seed, HTTP bodies or provider stack traces.
    console.error("MM runner rejected: "+String(error?.message||"unexpected error").slice(0,240));
    return res.status(503).json({status:"HALTED",message:"Maker tick failed; review function logs",network:"Stellar Testnet"});
  }
}
