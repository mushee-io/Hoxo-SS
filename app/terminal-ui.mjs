import {getMarket,filterMarkets,orderDraft} from "./terminal-state.mjs";

/** M2 — interface-only exchange workspace, explicitly no trading operations. */
const $=id=>document.getElementById(id);
const all=selector=>[...document.querySelectorAll(selector)];
const query=new URLSearchParams(window.location.search);
let market=getMarket(query.get("market")),chartView="price",bookView="book",timeframe="30m",orderType="Market",view="trade",filter="all";
function selectGroup(selector,value,key){
  all(selector).forEach(b=>{
    const selected=b.dataset[key]===value;
    b.classList.toggle("active",selected);
    b.setAttribute("aria-pressed",String(selected));
  });
}
function setView(next){
  view=["trade","portfolio","earn"].includes(next)?next:"trade";
  all("[data-view]").forEach(b=>b.classList.toggle("selected",b.dataset.view===view));
  $("tradeView").classList.toggle("hidden",view!=="trade");
  $("alternateView").classList.toggle("hidden",view==="trade");
  if(view==="portfolio"){
    $("altTitle").textContent="YOUR PORTFOLIO";
    $("altDescription").textContent="Testnet wallet balances appear under Trade → Balances. Exchange collateral, positions and margin are not deployed.";
  }else if(view==="earn"){
    $("altTitle").textContent="MONEY MARKETS";
    $("altDescription").textContent="Supply and borrowing require independently verified Soroban lending contracts and on-chain risk enforcement.";
  }
  const location=window.location.pathname+"?market="+encodeURIComponent(market.id)+(view==="trade"?"":"#"+view);
  window.history.replaceState(null,"",location);
}
function updateChart(){
  $("chartEmptyTitle").textContent=chartView==="price"?"NO VERIFIED MARKET DATA":chartView==="depth"?"DEPTH NOT DEPLOYED":"FUNDING NOT DEPLOYED";
  $("chartEmptyDescription").textContent=chartView==="price"
    ?market.label+" "+timeframe+" candles require a verified Stellar Testnet market-data feed."
    :chartView==="depth"?"Depth requires an operational order book and matching engine.":"Funding requires a deployed perpetual clearinghouse.";
  $("chartMarketStatus").textContent=market.label+" / "+timeframe+" / NO TESTNET CANDLE FEED";
  $("currentTimeframe").textContent=timeframe;
}
function updateBook(){
  const book=bookView==="book";
  $("bookEmptyTitle").textContent=book?"ORDER BOOK OFFLINE":"TRADES NOT DEPLOYED";
  $("bookEmptyDescription").textContent=book
    ?"No authenticated "+market.label+" orders exist. Matching is not deployed."
    :"Verified "+market.label+" fills require settlement and indexing.";
  $("bookPriceHeading").textContent="PRICE ("+market.quote+")";
  $("bookSizeHeading").textContent="SIZE ("+market.base+")";
}
function updateDraft(){
  const data=orderDraft({marketId:market.id,orderType,size:$("orderSize").value.trim(),limitPrice:$("limitPrice").value.trim()});
  $("draftFeedback").textContent=data.message;
  $("draftFeedback").classList.toggle("invalid",$("orderSize").value.trim()!==""&&!data.valid);
  $("ticketSize").textContent=data.sizeLabel;
  $("ticketNotional").textContent=data.notional;
}
function chooseOrderType(next){
  orderType=["Market","Limit","Advanced"].includes(next)?next:"Market";
  selectGroup("[data-order-type]",orderType,"orderType");
  $("limitPriceRow").classList.toggle("hidden",orderType!=="Limit");
  updateDraft();
}
function chooseSide(side){
  for(const [id,active] of [["buySide",side==="buy"],["sellSide",side!=="buy"]]){
    $(id).classList.toggle("selected",active);
    $(id).setAttribute("aria-pressed",String(active));
  }
}
function closeMenu(){
  $("marketMenu").classList.add("hidden");
  $("marketTrigger").setAttribute("aria-expanded","false");
}
function renderMenu(){
  const container=$("marketResults");
  container.replaceChildren();
  const results=filterMarkets($("marketSearch").value,filter);
  if(!results.length){
    const message=document.createElement("p");
    message.className="market-empty";message.textContent="No reference instruments match.";container.append(message);return;
  }
  results.forEach(item=>{
    const button=document.createElement("button");
    button.type="button";button.className="market-item";
    button.setAttribute("aria-current",String(item.id===market.id));
    const left=document.createElement("span");
    const title=document.createElement("strong");title.textContent=item.label;
    const desc=document.createElement("small");desc.textContent=item.description;
    left.append(title,desc);
    const badge=document.createElement("span");badge.className="market-item-tag";badge.textContent=item.type==="spot"?"SPOT":"PERP";
    button.append(left,badge);
    button.addEventListener("click",()=>{chooseMarket(item.id);closeMenu();$("marketTrigger").focus();});
    container.append(button);
  });
}
function chooseMarket(id){
  market=getMarket(id);
  $("marketLabel").textContent=market.label;
  $("marketSubheading").textContent=(market.type==="spot"?"SPOT":"PERPETUAL")+" REFERENCE · NOT LISTED";
  $("marketPrimaryStat").textContent=market.type==="spot"?"REFERENCE PRICE":"MARK PRICE";
  $("fundingStatLabel").textContent=market.type==="spot"?"FUNDING / N/A":"FUNDING / 1H";
  $("marginMode").textContent=market.type==="spot"?"SPOT · NO MARGIN":"CROSS MARGIN · OFFLINE";
  $("sizeAssetLabel").textContent=market.base;
  $("sizeAssetSuffix").textContent=market.base;
  $("ticketMarket").textContent=market.label;
  $("buySide").textContent=market.type==="spot"?"BUY":"BUY / LONG";
  $("sellSide").textContent=market.type==="spot"?"SELL":"SELL / SHORT";
  $("orderSize").value="";$("limitPrice").value="";
  updateChart();updateBook();updateDraft();setView(view);
}
all("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
$("backToTrade").addEventListener("click",()=>setView("trade"));
$("marketTrigger").addEventListener("click",()=>{
  if($("marketMenu").classList.contains("hidden")){
    $("marketMenu").classList.remove("hidden");
    $("marketTrigger").setAttribute("aria-expanded","true");
    renderMenu();$("marketSearch").focus();
  }else closeMenu();
});
$("marketSearch").addEventListener("input",renderMenu);
all("[data-market-filter]").forEach(b=>b.addEventListener("click",()=>{
  filter=b.dataset.marketFilter;
  all("[data-market-filter]").forEach(item=>{
    const selected=item===b;item.classList.toggle("selected",selected);item.setAttribute("aria-pressed",String(selected));
  });
  renderMenu();
}));
document.addEventListener("click",event=>{
  if(!$("marketMenu").classList.contains("hidden") && !$("marketMenu").contains(event.target) && !$("marketTrigger").contains(event.target))closeMenu();
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape" && !$("marketMenu").classList.contains("hidden")){closeMenu();$("marketTrigger").focus();}
});
all("[data-chart-view]").forEach(b=>b.addEventListener("click",()=>{
  chartView=b.dataset.chartView;selectGroup("[data-chart-view]",chartView,"chartView");updateChart();
}));
all("[data-book-view]").forEach(b=>b.addEventListener("click",()=>{
  bookView=b.dataset.bookView;selectGroup("[data-book-view]",bookView,"bookView");updateBook();
}));
all("[data-timeframe]").forEach(b=>b.addEventListener("click",()=>{
  timeframe=b.dataset.timeframe;selectGroup("[data-timeframe]",timeframe,"timeframe");updateChart();
}));
all("[data-order-type]").forEach(b=>b.addEventListener("click",()=>chooseOrderType(b.dataset.orderType)));
$("buySide").addEventListener("click",()=>chooseSide("buy"));
$("sellSide").addEventListener("click",()=>chooseSide("sell"));
$("orderSize").addEventListener("input",updateDraft);
$("limitPrice").addEventListener("input",updateDraft);
const initialView=window.location.hash.slice(1);
chooseSide("buy");chooseOrderType("Market");chooseMarket(market.id);
if(initialView==="portfolio"||initialView==="earn")setView(initialView);
