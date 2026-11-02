/**
 * M48 public-only orderbook display. Genuine bids/asks only; no fake maker
 * orders, wallet prompts, transaction signing, or Hoxo execution.
 */
import {normalizeM48KrakenDepth,normalizeM48HorizonBook,
  m48HorizonBookUrl} from "./m48-book-data.mjs";

const $=id=>document.getElementById(id);
const feed=$("m48BookFeed"),selector=$("m48BookSource"),list=$("m48BookLevels");
const state=$("m48BookStatus");
let chosenMarket="xlm-usdc-spot",bookView="book",sequence=0,requestId=0;
const eligible=new Set(["xlm-usdc-spot","xlm-usdc-perp"]);
function safe(){return eligible.has(chosenMarket)&&bookView==="book";}
function label(s,error=false){
  state.textContent=s;state.classList.toggle("m48-feed-error",error);
}
function clearRows(){
  list.replaceChildren();
  list.classList.add("hidden");
  $("bookEmptyTitle").parentElement.classList.remove("hidden");
  $("m48Spread").textContent="—";
}
function sourceHeading(){
  $("bookPriceHeading").textContent=selector.value==="kraken"?"PRICE (USD)":"PRICE (USDC)";
  $("bookSizeHeading").textContent="SIZE (XLM)";
  $("m48BookSourceWarning").textContent=selector.value==="kraken"?
    "KRAKEN XLM/USD · EXTERNAL SPOT ORDERS · NOT HOXO / NOT USDC":
    "STELLAR TESTNET XLM/USDC · CLASSIC DEX OFFERS · NOT HOXO M9";
}
function formatted(n,decimals=6){
  return Number(n).toLocaleString("en-US",{
    minimumFractionDigits:Math.min(decimals,2),maximumFractionDigits:decimals
  });
}
function paint(book){
  if(!safe())return;
  clearRows();
  if(!book||!Array.isArray(book.bids)||!Array.isArray(book.asks)||
    book.executable!==false||book.hoxoFills!==false){
    label("Orderbook source unavailable · no artificial price levels",true);
    return;
  }
  const bids=book.bids.slice(0,11),asks=book.asks.slice(0,11);
  if(!bids.length&&!asks.length){
    $("bookEmptyTitle").textContent="NO LIVE OFFERS";
    $("bookEmptyDescription").textContent=selector.value==="kraken"?
      "External Kraken order book returned no verified levels.":
      "No actual Stellar Testnet XLM/USDC offers exist in this classic DEX book.";
    label("0 genuine offers · no synthetic book or automatic self-trading");
    return;
  }
  const max=Math.max(1,...bids.concat(asks).map(row=>row.amount));
  const asksDisplay=asks.slice().reverse();
  for(const [side,levels] of [["ask",asksDisplay],["bid",bids]]){
    const section=document.createElement("div");
    section.className="m48-side m48-"+side;
    for(const row of levels){
      const node=document.createElement("div");node.className="m48-level m48-"+side;
      const percent=Math.max(1,Math.min(100,Math.round(100*row.amount/max)));
      node.style.setProperty("--m48-depth",percent+"%");
      for(const [value,className] of [
        [formatted(row.price,7),"m48-price"],[formatted(row.amount,4),"m48-size"],
        [formatted(row.total,3),"m48-total"]
      ]){
        const cell=document.createElement("span");cell.className=className;
        cell.textContent=value;node.append(cell);
      }
      section.append(node);
    }
    list.append(section);
    if(side==="ask"){
      const spread=document.createElement("div");spread.className="m48-mid";
      const ask=asks[0]?.price,bid=bids[0]?.price;
      spread.textContent=ask&&bid?
        "SPREAD "+formatted(Math.max(0,ask-bid),7)+" "+book.currency:
        "NO TWO-SIDED SPREAD";
      list.append(spread);
    }
  }
  $("bookEmptyTitle").parentElement.classList.add("hidden");
  list.classList.remove("hidden");
  $("m48Spread").textContent=book.spread===null?"—":
    formatted(book.spread,7)+" "+book.currency;
  label(book.source+" · "+(bids.length+asks.length)+
    " verified external offer levels · AUTO REFRESH · NOT HOXO FILLS");
}
async function sourceFetch(source){
  try{
    const response=await fetch("/api/market-orderbook?source="+encodeURIComponent(source),
      {cache:"no-store"});
    if(!response.ok)throw Error("proxy unavailable");
    const book=await response.json();
    if(book.sourceKind!==source||book.tradeExecutable!==false||
      book.hoxoSettlementEnabled!==false)throw Error("unverified source identity");
    return book;
  }catch{
    // Direct public API fallback for local static hosting, never placeholder data.
    const url=source==="kraken"?
      "https://api.kraken.com/0/public/Depth?pair=XLMUSD&count=20":
      m48HorizonBookUrl();
    const response=await fetch(url,{cache:"no-store"});
    if(!response.ok)throw Error("public market data unavailable");
    const data=await response.json();
    return source==="kraken"?normalizeM48KrakenDepth(data):
      normalizeM48HorizonBook(data);
  }
}
async function refresh(){
  if(!safe()||document.hidden)return;
  const marker=sequence,source=selector.value,request=++requestId;
  try{
    const result=await sourceFetch(source);
    if(marker===sequence&&request===requestId&&source===selector.value&&safe())paint(result);
  }catch{
    if(marker===sequence&&request===requestId&&safe()){
      clearRows();
      $("bookEmptyTitle").textContent="ORDER BOOK SOURCE UNAVAILABLE";
      $("bookEmptyDescription").textContent=
        "Genuine market levels could not be verified. Check the network and try again.";
      label("No real-time verified price levels · no simulated liquidity",true);
    }
  }
}
function selection(data){
  chosenMarket=data.market??chosenMarket;
  bookView=data.view??bookView;
  sequence++;
  clearRows();
  if(!safe()){
    feed.classList.add("hidden");
    $("bookEmptyTitle").parentElement.classList.remove("hidden");
    return;
  }
  feed.classList.remove("hidden");
  sourceHeading();
  $("bookEmptyTitle").textContent="LOADING LIVE ORDER BOOK";
  $("bookEmptyDescription").textContent="Fetching actual offers. No demo prices.";
  label("Connecting to the "+(selector.value==="kraken"?"Kraken":"Stellar Testnet")+
    " public order book...");
  refresh();
}
selector.addEventListener("change",()=>selection({}));
window.addEventListener("hoxo:book-selection",event=>selection(event.detail||{}));
$("m48BookRefresh").addEventListener("click",()=>{sequence++;refresh();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
window.setInterval(()=>{
  if(safe()&&!document.hidden)refresh();
},6000);
selection({});
