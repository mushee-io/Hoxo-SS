/**
 * M59 — Hoxo on-chain Testnet spot activity.
 * All numbers are read from /api/hoxo-testnet-activity and are NEVER sourced
 * from external reference feeds or optimistic/unconfirmed wallet requests.
 */
const $=id=>document.getElementById(id);
const surface=$("m47ChartSurface"),canvas=$("m47CandleCanvas"),ctx=canvas.getContext("2d");
const rows=$("m59TradeRows"),panel=$("m59Settlements");
let selectedMarket=new URLSearchParams(location.search).get("market")||"xlm-usdc-spot";
let selectedTab="book",lastResult=null,loading=false,epoch=0;
const SCALE=10000000n;
const isSpot=()=>selectedMarket==="xlm-usdc-spot";
function formatE7(value){
  if(typeof value!=="string"||!/^(0|[1-9]\d*)$/.test(value))return "—";
  const v=BigInt(value),whole=(v/SCALE).toString(),
    fraction=(v%SCALE).toString().padStart(7,"0").replace(/0+$/,"");
  return whole+(fraction?"."+fraction:"");
}
function message(s){
  $("m47SourceStatus").textContent=s;
  $("m59Status").textContent=s;
}
function showEmpty(title,details){
  surface.classList.add("hidden");canvas.setAttribute("aria-hidden","true");
  $("chartEmptyTitle").parentElement.classList.remove("hidden");
  $("chartEmptyTitle").textContent=title;
  $("chartEmptyDescription").textContent=details;
  $("m47LastPrice").textContent="—";
  $("marketPrice").textContent="—";
  $("m47LastPriceSource").textContent="M9 · NO VERIFIED SETTLEMENT PRICE";
}
function draw(trades){
  if(!isSpot()||!trades.length)return;
  surface.classList.remove("hidden");canvas.setAttribute("aria-hidden","false");
  $("chartEmptyTitle").parentElement.classList.add("hidden");
  const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  if(w<10||h<10)return;
  const ratio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const chart=trades.slice().reverse().filter(t=>Number.isFinite(t.priceQuotePerXlm)&&t.priceQuotePerXlm>0);
  if(!chart.length)return;
  const left=16,right=88,top=24,bottom=43,volumeHeight=Math.max(35,h*.18);
  const plotH=h-top-bottom-volumeHeight;
  const loPrice=Math.min(...chart.map(x=>x.priceQuotePerXlm)),
    hiPrice=Math.max(...chart.map(x=>x.priceQuotePerXlm));
  const padding=Math.max(.000002,(hiPrice-loPrice)*.12);
  const lo=loPrice-padding,hi=hiPrice+padding;
  const y=p=>top+(hi-p)/(hi-lo)*plotH;
  const step=(w-left-right)/Math.max(1,chart.length),bars=chart.map(x=>BigInt(x.baseAmountE7));
  const maxVolume=bars.reduce((a,b)=>a>b?a:b,1n);
  const maxVol=Number(maxVolume);
  ctx.font="10px monospace";
  for(let i=0;i<=4;i++){
    const yy=top+i*plotH/4;
    ctx.strokeStyle="rgba(127,157,149,.21)";
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();
    ctx.fillStyle="#9dabb0";ctx.fillText((hi-(hi-lo)*i/4).toFixed(6),w-right+6,yy+3);
  }
  chart.forEach((p,i)=>{
    const x=left+(i+.5)*step,prev=chart[Math.max(0,i-1)].priceQuotePerXlm;
    const up=p.priceQuotePerXlm>=prev,color=up?"#5ae3a1":"#f27386";
    const yy=y(p.priceQuotePerXlm);
    ctx.fillStyle=color;ctx.strokeStyle=color;
    const size=Math.max(3,Math.min(9,step*.3));
    ctx.fillRect(x-size/2,yy-size/2,size,size);
    if(i>0){ctx.lineWidth=1.5;ctx.beginPath();
      ctx.moveTo(left+(i-.5)*step,y(prev));ctx.lineTo(x,yy);ctx.stroke();}
    ctx.fillStyle=up?"rgba(90,227,161,.55)":"rgba(242,115,134,.55)";
    ctx.fillRect(x-size/2,h-bottom-(Number(bars[i])/maxVol)*volumeHeight,
      size,(Number(bars[i])/maxVol)*volumeHeight);
  });
  ctx.fillStyle="#8baaa4";ctx.font="10px monospace";
  const leftLedger=String(chart[0].ledger),rightLedger=String(chart.at(-1).ledger);
  ctx.fillText("LEDGER "+leftLedger,left,h-8);
  ctx.fillText("LEDGER "+rightLedger,Math.max(left,w-right-120),h-8);
}
function render(){
  const result=lastResult;
  panel.classList.toggle("hidden",selectedTab!=="trades"||!isSpot());
  const market= isSpot();
  $("m59Summary").classList.toggle("hidden",!market);
  if(!market){
    $("m59Volume").textContent="—";
    surface.classList.add("hidden");return;
  }
  if(!result){
    $("m59Volume").textContent="—";
    $("m59Summary").textContent="HOXO M9 · NETWORK VERIFICATION PENDING";
    showEmpty("VERIFYING STELLAR TESTNET","Waiting for independent M9 ledger evidence.");
    return;
  }
  if(result.state==="unavailable"){
    $("m59Volume").textContent="—";
    $("m59Summary").textContent="HOXO M9 · LEDGER DATA UNAVAILABLE";
    showEmpty("SETTLEMENT FEED UNAVAILABLE","Confirmed activity cannot currently be independently checked.");
    message("STELLAR TESTNET · RETRYING");
    return;
  }
  const count=result.verifiedCount,transactions=result.records||[];
  $("m59Volume").textContent=formatE7(result.verifiedXlmVolumeE7)+" XLM";
  $("m59Summary").textContent=
    "HOXO M9 · "+count+" VERIFIED SETTLEMENT"+(count===1?"":"S")+
    " · LEDGERS "+result.fromLedger+"–"+result.throughLedger+
    (result.mayBeTruncated?" · PARTIAL WINDOW":"");
  message(count+" CONFIRMED M9 SPOT TRANSACTIONS · LIVE TESTNET RPC");
  rows.replaceChildren();
  for(const t of transactions){
    const line=document.createElement("div");line.className="m59-trade-row";
    const link=document.createElement("a");
    link.href="https://stellar.expert/explorer/testnet/tx/"+t.transactionHash;
    link.target="_blank";link.rel="noopener noreferrer";
    link.textContent=t.transactionHash.slice(0,12)+"…"+t.transactionHash.slice(-8);
    const amount=document.createElement("span");amount.textContent=
      formatE7(t.baseAmountE7)+" XLM · "+formatE7(t.quoteAmountE7)+" USDC";
    const led=document.createElement("small");led.textContent="LEDGER #"+t.ledger;
    line.append(link,amount,led);rows.append(line);
  }
  if(!transactions.length){
    const p=document.createElement("p");p.className="m59-none";
    p.textContent="No confirmed M9 settlement events in the checked ledger window. "+
      "Complete a wallet-approved Testnet spot trade to create verifiable activity.";
    rows.append(p);
    showEmpty("AWAITING FIRST VERIFIED XLM/USDC SETTLEMENT",
      "Prices and volumes appear only after an on-chain M9 transaction succeeds.");
    $("chartMarketStatus").textContent="HOXO M9 · NO VERIFIED FILL IN CHECKED WINDOW";
    return;
  }
  const newest=transactions[0],price=newest.priceQuotePerXlm;
  if(!Number.isFinite(price)||price<=0)return;
  $("m47LastPrice").textContent=price.toFixed(7)+" USDC";
  $("marketPrice").textContent=price.toFixed(7)+" USDC";
  $("m47LastPriceSource").textContent="VERIFIED HOXO M9 SETTLEMENT · TESTNET";
  $("chartMarketStatus").textContent="HOXO M9 · "+count+" CONFIRMED SETTLEMENTS · RECENT LEDGER WINDOW";
  draw(transactions);
}
async function refresh(){
  if(loading||document.hidden||!isSpot())return;
  loading=true;const ticket=++epoch;
  try{
    const response=await fetch("/api/hoxo-testnet-activity",{cache:"no-store"});
    if(!response.ok)throw Error("M9 RPC evidence unavailable");
    const data=await response.json();
    if(data.network!=="Stellar Testnet"||
       data.contract!=="CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF"||
       !Number.isSafeInteger(data.verifiedCount)||data.verifiedCount<0||
       typeof data.verifiedXlmVolumeE7!=="string"||
       !Array.isArray(data.records)||data.mocked!==false||
       data.verifiedCount<data.records.length)
      throw Error("M9 evidence integrity check failed");
    if(ticket===epoch)lastResult=data;
  }catch{
    if(ticket===epoch)lastResult={state:"unavailable"};
  }finally{loading=false;render();}
}
window.addEventListener("hoxo:market-change",event=>{
  selectedMarket=String(event.detail?.market||"");lastResult=null;epoch++;
  render();if(isSpot())refresh();
});
window.addEventListener("hoxo:book-selection",event=>{
  selectedTab=event.detail?.view==="trades"?"trades":"book";
  selectedMarket=event.detail?.market||selectedMarket;
  render();
  if(selectedTab==="trades"&&isSpot())refresh();
});
window.addEventListener("resize",()=>{if(isSpot()&&lastResult?.records?.length)draw(lastResult.records);});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
window.setInterval(refresh,30000);
render();refresh();
