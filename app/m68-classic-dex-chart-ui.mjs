/**
 * M68: actual Stellar Horizon Classic DEX price candles, separate from M9.
 * No fake price candles, volume, bot fills or claim of Hoxo M9 settlement.
 */
const $=id=>document.getElementById(id);
const surface=$("m68DexChartSurface"),canvas=$("m68DexCandleCanvas"),
  ctx=canvas.getContext("2d"),selector=$("m68ChartSource");
const times=document.querySelector(".timeframes"),m9Surface=$("m47ChartSurface");
let market=new URLSearchParams(location.search).get("market")||"xlm-usdc-spot";
let chartView="price",frame="30m",bars=[],generation=0;
function dexActive(){return market==="xlm-usdc-spot"&&chartView==="price"&&selector.value==="stellar-dex";}
function setFeedStatus(message,warning=false){
  if(!dexActive())return;
  $("m47SourceStatus").textContent=message;
  $("m47SourceStatus").classList.toggle("offline-accent",warning);
}
function noData(title,detail){
  if(!dexActive())return;
  surface.classList.add("hidden");canvas.setAttribute("aria-hidden","true");
  $("chartEmptyTitle").parentElement.classList.remove("hidden");
  $("chartEmptyTitle").textContent=title;
  $("chartEmptyDescription").textContent=detail;
  $("m47LastPrice").textContent="—";
  $("marketPrice").textContent="—";
  $("m47LastPriceSource").textContent="STELLAR CLASSIC DEX · NO TRADE PRICE";
  $("chartMarketStatus").textContent="XLM/USDC · CLASSIC DEX · "+frame+" · TRADE HISTORY ONLY";
}
function plot(){
  if(!dexActive()||!bars.length)return;
  m9Surface.classList.add("hidden");
  surface.classList.remove("hidden");
  canvas.setAttribute("aria-hidden","false");
  $("chartEmptyTitle").parentElement.classList.add("hidden");
  const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  if(w<60||h<60)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  const left=16,right=90,top=34,bottom=32;
  const volumeHeight=Math.min(85,Math.max(28,h*.16));
  const usableH=Math.max(55,h-top-bottom-volumeHeight-8);
  const usableW=Math.max(40,w-left-right);
  const lo0=Math.min(...bars.map(b=>b.low)),hi0=Math.max(...bars.map(b=>b.high));
  const padding=Math.max(0.000001,(hi0-lo0)*0.1);
  const lo=Math.max(0,lo0-padding),hi=hi0+padding;
  const y=p=>top+(hi-p)/(hi-lo)*usableH;
  const step=usableW/bars.length,barW=Math.max(2,Math.min(14,step*.6));
  const maxVol=Math.max(0.00001,...bars.map(b=>b.volume));
  ctx.font="10px monospace";ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){
    const yy=top+i*usableH/4;
    ctx.strokeStyle="#ffffff16";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();
    ctx.fillStyle="#98aba6";
    ctx.fillText((hi-(hi-lo)*i/4).toFixed(5),w-right+6,yy);
  }
  for(let i=0;i<bars.length;i++){
    const b=bars[i],x=left+(i+.5)*step;
    const color=b.close>=b.open?"#65dc9b":"#f08391";
    ctx.strokeStyle=ctx.fillStyle=color;
    ctx.lineWidth=Math.max(1,Math.min(2,step*.15));
    ctx.beginPath();ctx.moveTo(x,y(b.high));ctx.lineTo(x,y(b.low));ctx.stroke();
    const yTop=y(Math.max(b.open,b.close)),yBottom=y(Math.min(b.open,b.close));
    ctx.fillRect(x-barW/2,yTop,barW,Math.max(1,yBottom-yTop));
    ctx.globalAlpha=.5;
    const volHeight=Math.max(1,(b.volume/maxVol)*volumeHeight);
    ctx.fillRect(x-barW/2,h-bottom-volHeight,barW,volHeight);
    ctx.globalAlpha=1;
  }
  ctx.fillStyle="#9baf9f";
  ctx.font="10px monospace";
  ctx.textBaseline="alphabetic";
  const date=t=>new Date(t).toISOString().slice(5,16).replace("T"," ");
  ctx.fillText(date(bars[0].time),left,h-9);
  ctx.fillText(date(bars.at(-1).time),Math.max(left,w-right-100),h-9);
  const last=bars.at(-1);
  $("marketPrimaryStat").textContent="CLASSIC DEX LAST TRADE";
  $("marketPrice").textContent=last.close.toFixed(7)+" USDC";
  $("m47LastPrice").textContent=last.close.toFixed(7)+" USDC";
  $("m47LastPriceSource").textContent="STELLAR TESTNET CLASSIC DEX · NOT HOXO M9";
  $("chartMarketStatus").textContent="STELLAR CLASSIC DEX · "+frame+
    " · "+bars.length+" REPORTED CANDLES · NOT HOXO M9";
  setFeedStatus("● STELLAR HORIZON · "+bars.length+" REAL TRADE INTERVALS");
}
function updateVisibility(){
  const isSpot=market==="xlm-usdc-spot";
  selector.classList.toggle("hidden",!isSpot||chartView!=="price");
  times.classList.toggle("hidden",!dexActive());
  surface.classList.toggle("hidden",!dexActive()||!bars.length);
  if(!dexActive()){
    canvas.setAttribute("aria-hidden","true");
    return;
  }
  m9Surface.classList.add("hidden");
  $("marketPrimaryStat").textContent="CLASSIC DEX LAST TRADE";
  if(bars.length)plot();
  else noData("LOADING REAL XLM/USDC CANDLES",
    "Reading Stellar Testnet Classic DEX trade aggregates. Hoxo M9 fills remain separate.");
}
async function refresh(){
  if(!dexActive()||document.hidden)return;
  const ticket=++generation;
  setFeedStatus("● CHECKING STELLAR CLASSIC DEX TRADES");
  try{
    const response=await fetch("/api/xlm-usdc-candles?frame="+encodeURIComponent(frame),{
      cache:"no-store",headers:{accept:"application/json"}
    });
    if(!response.ok)throw Error("Horizon candle feed unavailable");
    const result=await response.json();
    if(result.network!=="Stellar Testnet"||result.venue!=="Stellar Classic DEX"||
       result.frame!==frame||result.synthetic!==false||
       result.hoxoM9FillsAttributed!==0||!Array.isArray(result.candles)||
       result.candles.length>200)
      throw Error("Unverified trade aggregation source");
    const checked=result.candles.map(b=>{
      if(!Number.isSafeInteger(b.time)||!["open","high","low","close","volume"].every(k=>
        typeof b[k]==="number"&&Number.isFinite(b[k])&&b[k]>0)||
        !Number.isSafeInteger(b.trades)||b.trades<1||
        b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))
        throw Error("Invalid reported trade candle");
      return b;
    });
    if(ticket!==generation||!dexActive())return;
    bars=checked;
    if(!bars.length){
      noData("NO CLASSIC DEX TRADES IN SELECTED RANGE",
        "No confirmed trades are reported in this time window. Resting offers are not trades.");
      setFeedStatus("● HORIZON · NO TRADES IN WINDOW");
    }else plot();
  }catch{
    if(ticket!==generation||!dexActive())return;
    bars=[];
    noData("STELLAR CLASSIC DEX CHART UNAVAILABLE",
      "Cannot currently confirm recent trade candles. Order book and wallet-approved quotes use a separate feed.");
    setFeedStatus("● HORIZON CANDLE FEED UNAVAILABLE",true);
  }
}
selector.addEventListener("change",()=>{
  generation++;bars=[];
  window.dispatchEvent(new CustomEvent("hoxo:chart-source",{
    detail:{source:selector.value}
  }));
  updateVisibility();
  if(dexActive())void refresh();
});
window.addEventListener("hoxo:chart-selection",event=>{
  chartView=event.detail?.view??"price";
  frame=["1m","30m","1h","4h","1d"].includes(event.detail?.timeframe)?
    event.detail.timeframe:"30m";
  generation++;bars=[];
  updateVisibility();
  if(dexActive())void refresh();
});
window.addEventListener("hoxo:market-change",event=>{
  market=String(event.detail?.market??"");
  generation++;bars=[];
  updateVisibility();
  if(dexActive())void refresh();
});
window.addEventListener("resize",()=>{if(dexActive()&&bars.length)plot();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refresh();});
window.addEventListener("hoxo:spot-settled",()=>{if(dexActive())void refresh();});
setInterval(()=>{if(dexActive())void refresh();},30000);
updateVisibility();
void refresh();
