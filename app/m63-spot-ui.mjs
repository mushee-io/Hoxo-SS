/**
 * M63 — REAL one-wallet Classic DEX XLM/USDC Testnet swaps.
 * No synthetic volume, server key, delegated signing, M9 attribution or auto-trading.
 * Wallet approves each exact direct, atomic path-payment transaction.
 */
import {Asset,BASE_FEE,Horizon,Networks,Operation,StrKey,TransactionBuilder}
  from "@stellar/stellar-sdk";
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER,TESTNET_NETWORK,
  formatE7,parseE7,quoteDirectXlmUsdc,verifyQuoteFresh,validateBook,
  readUsdcBalance,assertCapacity} from "./m63-spot-core.mjs";

const $=id=>document.getElementById(id);
const server=new Horizon.Server(HORIZON_TESTNET);
const xlm=Asset.native();
const usdc=new Asset("USDC",USDC_TESTNET_ISSUER);
let reviewed=null,reviewedType=null,busy=false;
const noCache={cache:"no-store",headers:{accept:"application/json"}};
function fail(reason){throw Error("Hoxo Testnet Spot: "+reason);}
function side(){return $("buySide").getAttribute("aria-pressed")==="true"?"buy":"sell";}
function currentMarket(){
  return new URLSearchParams(window.location.search).get("market")==="xlm-usdc-spot";
}
function label(value,isError=false){
  const el=$("m63Status");
  el.textContent=value;
  el.classList.toggle("m63-error",isError);
}
function reset(){
  reviewed=null;reviewedType=null;
  $("m63Approve").disabled=true;
  $("m63Quote").textContent="No executable quote yet.";
  $("m63QuoteTime").textContent="—";
  $("m63Status").textContent="Enter an XLM amount and review direct Stellar Testnet market liquidity.";
  $("m63Status").classList.remove("m63-error");
  $("m63Receipt").replaceChildren();
  $("m63Receipt").textContent="No swap submitted.";
}
function active(){
  const enabled=currentMarket();
  $("m63SpotSwap").classList.toggle("hidden",!enabled);
  if(!enabled)reset();
}
async function fetchBook(){
  const url=new URL("/order_book",HORIZON_TESTNET);
  url.searchParams.set("selling_asset_type","native");
  url.searchParams.set("buying_asset_type","credit_alphanum4");
  url.searchParams.set("buying_asset_code","USDC");
  url.searchParams.set("buying_asset_issuer",USDC_TESTNET_ISSUER);
  url.searchParams.set("limit","200");
  const response=await fetch(url.href,noCache);
  if(!response.ok)fail("Stellar Testnet order book unavailable (HTTP "+response.status+")");
  return validateBook(await response.json());
}
function enforceType(){
  const selected=document.querySelector('[data-order-type][aria-pressed="true"]')?.dataset.orderType;
  if(selected!=="Market"&&selected!=="Limit")
    fail("choose MARKET or LIMIT, not the undeployed Advanced mode");
  return selected;
}
function limitAllowed(quote,kind){
  if(kind!=="Limit")return;
  const price=parseE7($("limitPrice").value.trim(),"limit price");
  const units=BigInt(quote.quantityE7);
  // Bound total quote using the exact user-set USDC/XLM limit.
  const total=quote.side==="buy"?(units*price+9_999_999n)/10_000_000n:
    units*price/10_000_000n;
  if(quote.side==="buy"&&BigInt(quote.limitQuoteE7)>total)
    fail("available Testnet ask prices exceed your BUY limit");
  if(quote.side==="sell"&&BigInt(quote.limitQuoteE7)<total)
    fail("available Testnet bid prices are below your SELL limit");
}
async function prepareReview(){
  if(!currentMarket())fail("this route only supports XLM/USDC spot");
  const action=side(),quantityXlm=$("orderSize").value.trim(),type=enforceType();
  parseE7(quantityXlm,"XLM quantity");
  const book=await fetchBook();
  const quote=quoteDirectXlmUsdc({side:action,quantityXlm,book,slippageBps:100});
  limitAllowed(quote,type);
  reviewed=quote;reviewedType=type;
  $("m63Approve").disabled=false;
  $("m63Quote").textContent=(action==="buy"?"BUY ":"SELL ")+quote.quantityXlm+
    " XLM | Expected "+quote.expectedUsdc+" USDC | "+
    (action==="buy"?"MAX SPEND ":"MIN RECEIVE ")+quote.limitUsdc+
    " USDC | 1% slippage protection | "+quote.levels+" real book level(s)";
  $("m63QuoteTime").textContent="Expires in 30 seconds · fresh quote required after changing order";
  label("Direct Stellar Testnet Classic DEX trade. One Freighter approval. "+
    "No second wallet, no fabricated Hoxo M9 volume. Review the quote, then approve.");
}
function writeReceipt({hash,ledger,quote}){
  const target=$("m63Receipt");target.replaceChildren();
  const intro=document.createElement("strong");
  intro.textContent="STELLAR TESTNET TRADE CONFIRMED · LEDGER "+ledger;
  const p=document.createElement("p");
  p.textContent=(quote.side==="buy"?"BOUGHT ":"SOLD ")+quote.quantityXlm+
    " XLM through Stellar Classic DEX. Signed and settled on-chain. "+
    "This is not an M9 contract settlement.";
  const a=document.createElement("a");
  a.href="https://stellar.expert/explorer/testnet/tx/"+hash;
  a.target="_blank";a.rel="noopener noreferrer";
  a.textContent="VIEW VERIFIED TRANSACTION "+hash.slice(0,12)+"…";
  target.append(intro,p,a);
}
function showBusy(isBusy){
  busy=isBusy;$("tradeButton").disabled=isBusy;$("m63Approve").disabled=isBusy||!reviewed;
  $("m63Approve").textContent=isBusy?"VERIFYING / WAITING FOR WALLET...":"CONFIRM & SIGN REAL TESTNET "+(reviewed?.side??side()).toUpperCase();
}
async function approve(){
  const quote=reviewed;
  if(!quote)fail("review a fresh order-book quote first");
  if(!currentMarket()||enforceType()!==reviewedType)
    fail("market or order type changed; review again");
  verifyQuoteFresh(quote,{side:side(),quantityXlm:$("orderSize").value.trim()});
  limitAllowed(quote,reviewedType);
  const api=window.freighterApi;
  if(!api||typeof api.getNetwork!=="function"||
    typeof api.getAddress!=="function"||typeof api.signTransaction!=="function")
    fail("official Freighter extension required; connect it before signing");
  if(typeof api.requestAccess==="function"){
    const access=await api.requestAccess();
    if(access?.error)fail("Freighter account access denied");
  }
  let net=await api.getNetwork();
  if(net?.error||net?.networkPassphrase!==TESTNET_NETWORK)
    fail("switch Freighter to Stellar TESTNET (not mainnet)");
  let wallet=await api.getAddress();
  const owner=wallet?.address;
  if(wallet?.error||!StrKey.isValidEd25519PublicKey(owner??""))
    fail("connect a funded Stellar Testnet G-address");
  // Re-read network book before signing and do not silently exceed the user's
  // original reviewed worst-case limit. Never cross non-direct assets.
  const refreshed=quoteDirectXlmUsdc({
    side:quote.side,quantityXlm:quote.quantityXlm,
    book:await fetchBook(),slippageBps:100
  });
  if(quote.side==="buy"&&BigInt(refreshed.expectedQuoteE7)>BigInt(quote.limitQuoteE7)||
     quote.side==="sell"&&BigInt(refreshed.expectedQuoteE7)<BigInt(quote.limitQuoteE7))
    fail("market price moved beyond your confirmed protection; review a new quote");
  label("Verifying exact Testnet account balance and building atomic direct swap...");
  const account=await server.loadAccount(owner);
  const balances=readUsdcBalance(account);
  assertCapacity({side:quote.side,quote,balance:balances,account});
  const operation=quote.side==="buy"?
    Operation.pathPaymentStrictReceive({
      sendAsset:usdc,sendMax:quote.limitUsdc,destination:owner,
      destAsset:xlm,destAmount:quote.quantityXlm,path:[]
    }):
    Operation.pathPaymentStrictSend({
      sendAsset:xlm,sendAmount:quote.quantityXlm,destination:owner,
      destAsset:usdc,destMin:quote.limitUsdc,path:[]
    });
  const baseFee=String(await server.fetchBaseFee());
  if(!/^[1-9]\d*$/.test(baseFee)||BigInt(baseFee)>1_000_000n)
    fail("unexpected Stellar network fee; refusing oversized fee");
  const tx=new TransactionBuilder(account,{
    fee:baseFee,networkPassphrase:Networks.TESTNET
  }).addOperation(operation).setTimeout(90).build();
  label("Freighter must explicitly approve one "+quote.side.toUpperCase()+
    " for "+quote.quantityXlm+" XLM. Transaction is not sent until approval.");
  const signedResult=await api.signTransaction(tx.toXDR(),{
    address:owner,networkPassphrase:Networks.TESTNET,submit:false
  });
  if(signedResult?.error||typeof signedResult?.signedTxXdr!=="string")
    fail("Freighter signature rejected, no trade submitted");
  if(signedResult.signerAddress&&signedResult.signerAddress!==owner)
    fail("Freighter signed with a different account");
  const signed=TransactionBuilder.fromXDR(signedResult.signedTxXdr,Networks.TESTNET);
  if(signed.source!==owner||signed.hash().toString("hex")!==tx.hash().toString("hex")||
     signed.operations.length!==1||signed.signatures.length===0)
    fail("wallet returned modified or unsigned trade; refusing broadcast");
  net=await api.getNetwork();wallet=await api.getAddress();
  if(net.networkPassphrase!==Networks.TESTNET||wallet.address!==owner)
    fail("wallet network/account changed during signature; refusing submission");
  label("Signature checked. Submitting exact one-operation Stellar Testnet swap...");
  const response=await server.submitTransaction(signed);
  const hash=response?.hash;
  if(typeof hash!=="string"||!/^[a-f0-9]{64}$/i.test(hash)||
    response.successful===false)
    fail("network did not return a confirmed valid swap hash");
  // Independent Horizon read: result must be explicitly successful.
  const check=await fetch(HORIZON_TESTNET+"/transactions/"+hash,noCache);
  if(!check.ok)
    throw Error("Transaction was submitted; confirmation lookup failed. Check Testnet explorer hash "+hash+
      " before retrying");
  const receipt=await check.json();
  if(receipt.hash?.toLowerCase()!==hash.toLowerCase()||
     receipt.successful!==true||!Number.isSafeInteger(receipt.ledger)||receipt.ledger<=0)
    throw Error("A transaction exists but verified successful settlement is not proven: "+hash);
  writeReceipt({hash:hash.toLowerCase(),ledger:receipt.ledger,quote});
  label("On-chain "+quote.side.toUpperCase()+" confirmed in Stellar Testnet ledger "+
    receipt.ledger+". Hash shown below.");
  window.dispatchEvent(new CustomEvent("hoxo:spot-settled",{
    detail:{hash:hash.toLowerCase(),ledger:receipt.ledger,venue:"Stellar Classic DEX"}
  }));
  reviewed=null;
  $("m63Approve").disabled=true;
}
$("tradeButton").addEventListener("click",async()=>{
  if(busy||!currentMarket())return;
  showBusy(true);
  try{await prepareReview();}
  catch(error){reset();label(String(error?.message??error),true);}
  finally{showBusy(false);}
});
$("m63Approve").addEventListener("click",async()=>{
  if(busy)return;showBusy(true);
  try{await approve();}
  catch(error){
    label(String(error?.response?.data?.extras?.result_codes?.operations?.join(", ")||
      error?.message||error),true);
    reviewed=null;
  }finally{showBusy(false);}
});
for(const id of ["orderSize","limitPrice"])
  $(id).addEventListener("input",()=>{if(!busy)reset();});
for(const id of ["buySide","sellSide"])
  $(id).addEventListener("click",()=>{if(!busy)reset();});
for(const btn of document.querySelectorAll("[data-order-type]"))
  btn.addEventListener("click",()=>{if(!busy)reset();});
window.addEventListener("hoxo:market-change",active);
active();
