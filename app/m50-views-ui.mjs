/**
 * M50 real Stellar Testnet wallet portfolio + conservative Earn workspace.
 * Source-of-truth: verified Freighter public G-address + Horizon network proof.
 * No XDR, no signing, no on-chain writes, no faux yields, no deposits.
 */
import {loadM50ClassicDexPortfolio} from "../portfolio/m50-classic-dex.mjs";
import {getM50MoneyMarketRegistryStatus,previewM50EarnIntent}
  from "../portfolio/m50-earn.mjs";
import {M48_CIRCLE_TEST_ISSUER} from "./m48-book-data.mjs";

const $=id=>document.getElementById(id);
let wallet={status:"disconnected",address:null,balances:[],ledger:null};
let selectedView="trade",request=0,portfolio=null,portfolioError=null,
  loading=false,registryStatus=null;
const fmt=address=>address?.slice(0,10)+"…"+address?.slice(-8);
function node(tag,text,className){
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  if(className)el.className=className;
  return el;
}
function verified(){
  return wallet.status==="connected"&&
    typeof wallet.address==="string"&&wallet.address.startsWith("G")&&
    Number.isSafeInteger(wallet.ledger);
}
function row(label,value){
  const el=node("div",undefined,"m50-metric");
  el.append(node("span",label),node("strong",value));
  return el;
}
function panel(title,subtitle){
  const el=node("article",undefined,"m50-panel");
  el.append(node("h2",title),node("p",subtitle,"m50-intro"));
  return el;
}
function setState(message){
  $("m50PortfolioStatus").textContent=message;
}
function renderPortfolio(){
  const root=$("m50PortfolioContent");
  root.replaceChildren();
  $("m50RefreshPortfolio").disabled=!verified()||loading;
  if(!verified()){
    root.append(panel("CONNECT YOUR TESTNET WALLET",
      "Connect Freighter from the top-right button to inspect verified public holdings."));
    setState("No verified Stellar Testnet wallet connected");
    return;
  }
  if(loading){
    setState("Verifying Stellar Testnet Horizon and account-specific offers/trades...");
    root.append(panel("VERIFYING WALLET DATA",
      "Checking current network and account ownership before showing public account activity."));
    return;
  }
  if(!portfolio||portfolio.owner!==wallet.address){
    setState(portfolioError?"Public portfolio unavailable: "+portfolioError:
      "Wallet connected · click Refresh Portfolio to read on-chain data");
    root.append(panel("READ-ONLY PORTFOLIO",
      "Verified wallet holdings are available. Fetch public Horizon offers and classic DEX trades to continue."));
    return;
  }
  setState("STELLAR TESTNET HORIZON · LEDGER "+portfolio.ledger+
    " · READ ONLY · NO HOXO SETTLEMENT CONFIRMED");
  const assets=panel("VERIFIED WALLET ASSETS",
    "Exact balance from this public Stellar Testnet account. Neither margin nor protocol collateral.");
  const holdings=node("div",undefined,"m50-rows");
  for(const b of portfolio.balances){
    const record=row(b.asset,b.balance+" · "+(b.issuer==="Native Stellar asset"?"NATIVE":fmt(b.issuer)));
    holdings.append(record);
  }
  if(!portfolio.balances.length)holdings.append(node("p","No wallet assets reported."));
  assets.append(holdings);
  const offers=panel("OPEN CLASSIC STELLAR DEX OFFERS",
    "These are genuine offers attached to your wallet on the Stellar classic DEX, NOT orders placed on Hoxo.");
  for(const offer of portfolio.offers){
    offers.append(row("#"+offer.id+" · SELL "+offer.selling.code,
      offer.amount+" "+offer.selling.code+" → "+offer.buying.code));
  }
  if(!portfolio.offers.length)offers.append(node("p","No classic DEX offers on the latest verified page."));
  const trades=panel("PUBLIC CLASSIC DEX TRADE HISTORY",
    "Horizon account trades only. Not perpetual positions, Hoxo fills, verified PnL or total trading volume.");
  for(const t of portfolio.trades){
    trades.append(row(new Date(t.createdAt).toLocaleString()+" · "+t.mechanism.toUpperCase(),
      t.baseAmount+" "+t.base.code+" / "+t.counterAmount+" "+t.counter.code));
  }
  if(!portfolio.trades.length)trades.append(node("p","No classic DEX trades on the latest verified page."));
  root.append(assets,offers,trades);
  root.append(node("p","Latest 20 offers/trades only. External Horizon evidence does not verify Hoxo's own financial contracts.","m50-foot"));
}
async function refreshPortfolio(){
  if(!verified()||loading)return;
  const owner=wallet.address,seq=++request;
  loading=true;renderPortfolio();
  try{
    const result=await loadM50ClassicDexPortfolio(owner);
    if(seq!==request||wallet.address!==owner)return;
    portfolio=result;portfolioError=null;
  }catch(error){
    if(seq===request&&wallet.address===owner){
      portfolio=null;portfolioError=String(error?.message||error);
    }
  }finally{
    if(seq===request){loading=false;renderPortfolio();}
  }
}
function renderEarn(){
  const root=$("m50EarnContent");root.replaceChildren();
  $("m50EarnPreview").disabled=!verified();
  const market=panel("STELLAR TESTNET LENDING",
    "Money-market contract source exists in GitHub. Live supply, borrowing, rates and exchange positions require an independently verified deployed pool.");
  market.append(row("M10 pool",registryStatus?.reason??"Readiness not checked"));
  market.append(row("Verified supply APY","— · NO LIVE RATE"));
  market.append(row("Supply / Withdraw","NOT ENABLED"));
  market.append(row("Borrow / Repay","NOT ENABLED"));
  const walletSection=panel("WALLET ASSETS",
    "Your Testnet wallet holdings; not Hoxo Earn deposits or lendable collateral.");
  if(verified()){
    walletSection.append(row("Connected account",fmt(wallet.address)));
    for(const b of wallet.balances){
      if(b.asset==="XLM"||b.asset==="USDC")
        walletSection.append(row(b.asset+(b.asset==="USDC"?" · "+fmt(b.issuer):""),
          b.balance+" · WALLET ONLY"));
    }
  }else walletSection.append(node("p","Connect a verified Testnet wallet to review your assets."));
  root.append(market,walletSection);
}
async function checkRegistry(){
  try{
    const resp=await fetch("../registry/testnet.json",{method:"GET",cache:"no-store"});
    if(!resp.ok)throw Error("registry read unavailable");
    registryStatus=getM50MoneyMarketRegistryStatus(await resp.json());
  }catch(error){
    registryStatus={reason:"Deployment registry unavailable or invalid; treat pool as unverified"};
  }
  if(selectedView==="earn")renderEarn();
}
$("m50RefreshPortfolio").addEventListener("click",refreshPortfolio);
$("m50EarnPreview").addEventListener("click",()=>{
  const out=$("m50EarnFeedback");
  if(!verified()){out.textContent="Connect your Stellar Testnet wallet first.";return;}
  const asset=$("m50EarnAsset").value;
  const issuer=asset==="USDC"?M48_CIRCLE_TEST_ISSUER:null;
  const holding=wallet.balances.find(b=>b.asset===asset&&
    (asset==="XLM"||b.issuer===issuer));
  if(!holding){out.textContent="That exact Testnet wallet asset is not held or verified.";return;}
  try{
    const p=previewM50EarnIntent({
      owner:wallet.address,network:"Stellar Testnet",
      asset,issuer,walletBalance:holding.balance,amount:$("m50EarnAmount").value.trim()
    });
    out.textContent="UNSIGNED TESTNET PLAN · "+p.amountE7+
      " (7-decimal units) "+asset+
      " · WALLET BALANCE CHECK PASSED · NO DEPOSIT, APY OR WALLET TRANSACTION.";
  }catch(e){out.textContent=String(e?.message||e)+" · NO TRANSACTION CREATED.";}
});
window.addEventListener("hoxo:wallet-state",event=>{
  const prev=wallet.address;
  wallet=event.detail;
  if(prev!==wallet.address){request++;portfolio=null;portfolioError=null;loading=false;}
  if(selectedView==="portfolio"){
    renderPortfolio();
    if(verified()&&!portfolio&&!loading&&!portfolioError)void refreshPortfolio();
  }
  if(selectedView==="earn")renderEarn();
});
window.addEventListener("hoxo:view",event=>{
  selectedView=event.detail?.view??"trade";
  if(selectedView==="portfolio"){
    renderPortfolio();
    if(verified()&&!portfolio&&!loading)void refreshPortfolio();
  }
  if(selectedView==="earn")renderEarn();
});
checkRegistry();
renderPortfolio();
renderEarn();
