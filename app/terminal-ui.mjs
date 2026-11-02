import {getMarket,filterMarkets,orderDraft,parseAmount7} from "./terminal-state.mjs";

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
  view=["trade","portfolio","earn","network"].includes(next)?next:"trade";
  all("[data-view]").forEach(b=>b.classList.toggle("selected",b.dataset.view===view));
  $("tradeView").classList.toggle("hidden",view!=="trade");
  $("alternateView").classList.toggle("hidden",view==="trade");
  $("m45SigningLab")?.classList.toggle("hidden",view!=="trade"||market.type!=="spot");
  $("m55OpenLab")?.classList.toggle("hidden",view!=="trade"||market.type!=="spot");
  $("m46WindowsLab")?.classList.toggle("hidden",view!=="trade");
  if(view==="portfolio"){
    $("altTitle").textContent="YOUR PORTFOLIO";
    $("altDescription").textContent="Testnet wallet balances appear under Trade → Balances. Exchange collateral, positions and margin are not deployed.";
  }else if(view==="earn"){
    $("altTitle").textContent="MONEY MARKETS";
    $("altDescription").textContent="Supply and borrowing require independently verified Soroban lending contracts and on-chain risk enforcement.";
  }
  if(view==="network"){
    $("altTitle").textContent="STELLAR TESTNET INFRASTRUCTURE";
    $("altDescription").textContent="Live read-only Horizon and Stellar RPC health, exact network passphrase, ledger reconciliation, and undeployed contract registry.";
  }
  $("alternateCards").classList.toggle("hidden",view==="network");
  $("networkPanel").classList.toggle("hidden",view!=="network");
  window.dispatchEvent(new CustomEvent("hoxo:view",{detail:{view}}));
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
  window.dispatchEvent(new CustomEvent("hoxo:chart-selection",{detail:{market:market.id,view:chartView,timeframe}}));
}
function updateBook(){
  const book=bookView==="book";
  $("bookEmptyTitle").textContent=book?"CONNECTING LIVE ORDER BOOK":"TRADE HISTORY";
  $("bookEmptyDescription").textContent=book
    ?"No authenticated "+market.label+" orders exist. Matching is not deployed."
    :"Hoxo "+market.label+" executions will appear here after verified on-chain settlement.";
  $("bookPriceHeading").textContent="PRICE ("+market.quote+")";
  $("bookSizeHeading").textContent="SIZE ("+market.base+")";
  window.dispatchEvent(new CustomEvent("hoxo:book-selection",{
    detail:{market:market.id,view:bookView}
  }));
}
function updateDraft(){
  const quantity=$("orderSize").value.trim();
  const data=orderDraft({marketId:market.id,orderType,size:quantity,limitPrice:$("limitPrice").value.trim()});
  const amount=parseAmount7(quantity);
  const invalid=quantity!==""&&!data.valid;
  $("draftFeedback").textContent=data.message;
  $("draftFeedback").classList.toggle("invalid",invalid);
  $("orderSize").setAttribute("aria-invalid",String(invalid));
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
  const spotAction=market.id==="xlm-usdc-spot";
  const tradeButton=$("tradeButton");
  tradeButton.disabled=!spotAction;
  tradeButton.classList.toggle("trade-review",spotAction);
  tradeButton.textContent=spotAction?
    "REVIEW SMALL TESTNET "+(side==="buy"?"BUY":"SELL"):
    "PERP EXECUTION NOT YET DEPLOYED";
  const tradeSide=$("m51SpotSide");
  if(market.type==="spot"&&tradeSide&&tradeSide.value!==side){
    tradeSide.value=side;
    tradeSide.dispatchEvent(new Event("input",{bubbles:true}));
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
  const previousMarket=market.id;
  market=getMarket(id);
  if(previousMarket!==market.id)
    window.dispatchEvent(new CustomEvent("hoxo:market-change",{detail:{market:market.id}}));
  $("m45SigningLab")?.classList.toggle("hidden",market.type!=="spot"||view!=="trade");
  $("m55OpenLab")?.classList.toggle("hidden",market.type!=="spot"||view!=="trade");
  if(previousMarket!==market.id){
    // Return to live market depth when switching instruments. The earlier
    // Trades tab is Hoxo fills only, so it may correctly have no entries.
    bookView="book";selectGroup("[data-book-view]",bookView,"bookView");
  }
  $("marketLabel").textContent=market.label;
  $("marketSubheading").textContent=market.type==="spot"?
    "SPOT · STELLAR TESTNET SETTLEMENT":"PERP · REFERENCE MARKET";
  $("marketPrimaryStat").textContent=market.type==="spot"?
    "LAST VERIFIED M9 PRICE":"PERP REFERENCE PRICE";
  $("fundingStatLabel").textContent=market.type==="spot"?"FUNDING / N/A":"FUNDING / 1H";
  $("marginMode").textContent=market.type==="spot"?"SPOT · TESTNET":"PERP · TESTNET PREVIEW";
  $("sizeAssetLabel").textContent=market.base;
  $("sizeAssetSuffix").textContent=market.base;
  $("ticketMarket").textContent=market.label;
  $("buySide").textContent=market.type==="spot"?"BUY":"BUY / LONG";
  $("sellSide").textContent=market.type==="spot"?"SELL":"SELL / SHORT";
  $("orderSize").value="";$("limitPrice").value="";
  chooseSide($("buySide").getAttribute("aria-pressed")==="true"?"buy":"sell");
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
function openSpotSettlementReview(){
  if(market.id!=="xlm-usdc-spot")return;
  const input=$("orderSize"),requested=input.value.trim(),units=parseAmount7(requested);
  if(units===null){
    $("draftFeedback").textContent=
      "Enter a positive XLM amount using up to seven decimals. No order has been sent.";
    $("draftFeedback").classList.add("invalid");
    input.setAttribute("aria-invalid","true");
    input.focus();
    return;
  }
  $("m45Xlm").value=requested;
  $("m45Xlm").dispatchEvent(new Event("input",{bubbles:true}));
  $("draftFeedback").textContent="Checking Testnet readiness for "+requested+
    " XLM. Specify a distinct counterparty's public G-address; both wallets must approve the exact XLM/USDC terms. No transaction sent.";
  $("draftFeedback").classList.remove("invalid");
  input.setAttribute("aria-invalid","false");
  $("m45SigningLab")?.scrollIntoView({behavior:"smooth",block:"start"});
  $("m45Check")?.focus();
  // Read-only check only. Never trigger signatures or send from this button.
  $("m45Check")?.click();
}
$("tradeButton").addEventListener("click",openSpotSettlementReview);
$("m55OpenLab")?.addEventListener("click",openSpotSettlementReview);
$("orderSize").addEventListener("input",updateDraft);
$("limitPrice").addEventListener("input",updateDraft);
const initialView=window.location.hash.slice(1);
chooseSide("buy");chooseOrderType("Market");chooseMarket(market.id);
if(initialView==="portfolio"||initialView==="earn"||initialView==="network")setView(initialView);
