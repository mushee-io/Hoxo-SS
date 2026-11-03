/**
 * M64 — real Stellar Testnet Classic DEX OHLC chart.
 *
 * The chart is sourced exclusively from official Horizon trade_aggregations
 * for native XLM / the exact Testnet USDC issuer. It never attributes
 * Classic DEX prices or volumes to Hoxo M9 contract settlements.
 */
import {HORIZON_TESTNET,USDC_TESTNET_ISSUER} from "./m63-spot-core.mjs";

const $=id=>document.getElementById(id);
const surface=$("m64DexChartSurface"),canvas=$("m64DexCandleCanvas"),ctx=canvas.getContext("2d");
const source=$("m64ChartSource");
const FRAME=Object.freeze({
  "1m":{resolution:60000,interval:60000},
  "30m":{resolution:900000,interval:1800000},
  "1h":{resolution:3600000,interval:3600000},
  "4h":{resolution:3600000,interval:14400000},
  "1d":{resolution:86400000,interval:86400000}
});
let selectedMarket=new URLSearchParams(location.search).get("market")||"xlm-usdc-spot";
let selectedView="price",timeframe="30m",loading=false,request=0,rows=[];
const numeric=x=>typeof x==="string" && /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(x) &&
  Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
const integer=x=>{
  const n=Number(x);return Number.isSafeInteger(n)&&n>=0?n:null;
};
/** Exact supported Horizon source and fixed Stellar Testnet XLM/USDC market. */
export function tradeAggregationUrl({nowMs=Date.now(),frame="30m"}={}){
  const spec=FRAME[frame];
  if(!spec||!Number.isSafeInteger(nowMs)||nowMs<=0)
    throw Error("Unsupported XLM/USDC candle timeframe");
  const start=Math.floor((nowMs-spec.interval*90)/spec.resolution)*spec.resolution;
  const end=Math.ceil(nowMs/spec.resolution)*spec.resolution;
  const url=new URL("/trade_aggregations",HORIZON_TESTNET);
  for(const [key,value] of Object.entries({
    base_asset_type:"native",counter_asset_type:"credit_alphanum4",
    counter_asset_code:"USDC",counter_asset_issuer:USDC_TESTNET_ISSUER,
    resolution:String(spec.resolution),start_time:String(start),
    end_time:String(end),order:"asc",limit:"200"
  }))url.searchParams.set(key,value);
  return url;
}
/** Merge 15-minute/1-hour true OHLC records into 30m/4h buckets, no synthetic bars. */
export function aggregateClassicDexCandles(payload,{frame="30m"}={}){
  const spec=FRAME[frame];
  if(!spec||!payload||!Array.isArray(payload?._embedded?.records))
    throw Error("Unverified Horizon trade aggregation format");
  const raw=payload._embedded.records,groups=new Map();
  if(raw.length>200)throw Error("Unexpected Horizon aggregation size");
  for(const item of raw){
    const timestamp=integer(item.timestamp),count=integer(item.trade_count);
    const open=numeric(item.open),high=numeric(item.high),low=numeric(item.low),
      close=numeric(item.close),volume=numeric(item.base_volume);
    if(timestamp===null||count===null||count===0||
       open===null||high===null||low===null||close===null||volume===null||
       high<Math.max(open,close)||low>Math.min(open,close)||high<low)
      throw Error("Invalid Horizon OHLC trade evidence");
    const key=Math.floor(timestamp/spec.interval)*spec.interval;
    const previous=groups.get(key);
    if(!previous){
      groups.set(key,{timestamp:key,open,high,low,close,volume,count});
    }else{
      previous.high=Math.max(previous.high,high);
      previous.low=Math.min(previous.low,low);
      previous.close=close;
      previous.volume+=volume;
      previous.count+=count;
    }
  }
  return [...groups.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-90);
}
const isSpot=()=>selectedMarket==="xlm-usdc-spot";
const isDex=()=>source.value==="stellar-dex";
const applicable=()=>isSpot()&&isDex()&&selectedView==="price";
function setStatus(message,unavailable=false){
  if(!applicable())return;
  $("m47SourceStatus").textContent=message;
  $("m47SourceStatus").classList.toggle("offline-accent",unavailable);
}
function clearChart(title,detail){
  if(!applicable())return;
  surface.classList.add("hidden");canvas.setAttribute("aria-hidden","true");
  $("chartEmptyTitle").parentElement.classList.remove("hidden");
  $("chartEmptyTitle").textContent=title;
  $("chartEmptyDescription").textContent=detail;
  $("m47LastPrice").textContent="—";
  $("m47LastPriceSource").textContent="STELLAR CLASSIC DEX · NO RECENT TRADE PRICE";
  $("marketPrice").textContent="—";
  $("chartMarketStatus").textContent="STELLAR TESTNET CLASSIC DEX · "+timeframe+" · ACTUAL TRADES ONLY";
}
function draw(){
  if(!applicable()||!rows.length)return;
  surface.classList.remove("hidden");canvas.setAttribute("aria-hidden","false");
  $("chartEmptyTitle").parentElement.classList.add("hidden");
  const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;
  if(w<40||h<40)return;
  const ratio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const left=18,right=94,top=36,bottom=36,volH=Math.max(28,h*.18),
    plotH=h-top-bottom-volH,usable=Math.max(60,w-left-right);
  const lo0=Math.min(...rows.map(x=>x.low)),hi0=Math.max(...rows.map(x=>x.high));
  const pad=Math.max(.000001,(hi0-lo0)*.12),lo=Math.max(0,lo0-pad),hi=hi0+pad;
  const y=p=>top+(hi-p)/(hi-lo)*plotH;
  const step=usable/rows.length,barWidth=Math.max(2,Math.min(13,step*.55));
  const maxVol=Math.max(...rows.map(x=>x.volume),.000001);
  ctx.font="10px monospace";
  for(let i=0;i<=4;i++){
    const yy=top+i*plotH/4;
    ctx.strokeStyle="rgba(125,165,140,.22)";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();
    ctx.fillStyle="#a5bab1";
    ctx.fillText((hi-(hi-lo)*i/4).toFixed(5),w-right+6,yy+4);
  }
  rows.forEach((bar,i)=>{
    const x=left+(i+.5)*step,up=bar.close>=bar.open;
    ctx.strokeStyle=ctx.fillStyle=up?"#64e6a2":"#ef8190";
    ctx.lineWidth=Math.max(1,Math.min(2,step*.16));
    ctx.beginPath();ctx.moveTo(x,y(bar.high));ctx.lineTo(x,y(bar.low));ctx.stroke();
    const yy=y(Math.max(bar.open,bar.close)),bottomBody=y(Math.min(bar.open,bar.close));
    ctx.fillRect(x-barWidth/2,yy,barWidth,Math.max(1,bottomBody-yy));
    ctx.globalAlpha=.47;
    ctx.fillRect(x-barWidth/2,h-bottom-(bar.volume/maxVol)*volH,
      barWidth,(bar.volume/maxVol)*volH);
    ctx.globalAlpha=1;
  });
  ctx.fillStyle="#97b4a0";
  ctx.fillText(new Date(rows[0].timestamp).toISOString().slice(5,16).replace("T"," "),left,h-10);
  ctx.fillText(new Date(rows.at(-1).timestamp).toISOString().slice(5,16).replace("T"," "),
    Math.max(left,w-right-95),h-10);
  const last=rows.at(-1);
  $("marketPrice").textContent=last.close.toFixed(7)+" USDC";
  $("m47LastPrice").textContent=last.close.toFixed(7)+" USDC";
  $("m47LastPriceSource").textContent="STELLAR TESTNET CLASSIC DEX TRADE · NOT HOXO M9";
  $("chartMarketStatus").textContent="CLASSIC DEX · "+timeframe+" · "+rows.length+
    " ACTUAL TRADED CANDLE"+(rows.length===1?"":"S")+" · NOT HOXO M9";
  setStatus("CLASSIC DEX · "+rows.length+" VERIFIED HORIZON INTERVALS");
}
function show(){
  const visible=applicable();
  surface.classList.toggle("hidden",!visible||rows.length===0);
  if(!visible)return;
  $("marketPrimaryStat").textContent="CLASSIC DEX LAST TRADE";
  $("m47CandleCanvas").setAttribute("aria-hidden","true");
  $("m47ChartSurface").classList.add("hidden");
  $("m47ChartSurface").classList.remove("hidden"); // preserve existing display state below
  $("m47ChartSurface").classList.add("hidden");
  $("m47CandleCanvas").setAttribute("aria-hidden","true");
  $("m64ChartSource").value="stellar-dex";
  $("m64DexWatermark").textContent="STELLAR CLASSIC DEX · TESTNET";
  $("m64DexWarning").textContent="EXTERNAL CLASSIC DEX TRADES · NOT HOXO M9";
  if(rows.length)draw();
  else clearChart("CHECKING CLASSIC DEX TRADE HISTORY",
    "Loading independently indexed XLM/USDC trade candles from Stellar Testnet Horizon.");
}
async function refresh(){
  if(!applicable()||loading||document.hidden)return;
  loading=true;const ticket=++request;
  setStatus("CHECKING CLASSIC DEX TRADE AGGREGATES...");
  try{
    const url=tradeAggregationUrl({frame:timeframe});
    const res=await fetch(url,{cache:"no-store",headers:{accept:"application/json"}});
    if(!res.ok)throw Error("Horizon returned HTTP "+res.status);
    const result=aggregateClassicDexCandles(await res.json(),{frame:timeframe});
    if(ticket!==request||!applicable())return;
    rows=result;
    if(!rows.length){
      clearChart("NO CLASSIC DEX TRADES IN THIS INTERVAL",
        "No trades were reported for this XLM/USDC time range. Live resting offers can still exist.");
      setStatus("CLASSIC DEX · NO TRADES IN REQUESTED WINDOW");
      return;
    }
    draw();
  }catch(error){
    if(ticket!==request||!applicable())return;
    rows=[];
    clearChart("CLASSIC DEX CHART UNAVAILABLE",
      "Trade history could not be independently checked. Order quotes use a separately refreshed live book.");
    setStatus("CLASSIC DEX TRADE HISTORY UNAVAILABLE",true);
  }finally{loading=false;}
}
source.addEventListener("change",()=>{
  request++;rows=[]; // a source switch never reuses the other venue's prices
  window.dispatchEvent(new CustomEvent("hoxo:chart-source",{detail:{source:source.value}}));
  if(isDex()) {show();void refresh();}
});
window.addEventListener("hoxo:chart-selection",event=>{
  selectedView=event.detail?.view??"price";
  timeframe=FRAME[event.detail?.timeframe]?event.detail.timeframe:"30m";
  request++;rows=[];
  if(applicable()) {show();void refresh();}
  else surface.classList.add("hidden");
});
window.addEventListener("hoxo:market-change",event=>{
  selectedMarket=String(event.detail?.market??"");
  request++;rows=[];
  if(applicable()) {show();void refresh();}
  else surface.classList.add("hidden");
});
window.addEventListener("resize",()=>{if(applicable()&&rows.length)draw();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refresh();});
window.addEventListener("hoxo:spot-settled",()=>{if(applicable())void refresh();});
setInterval(()=>{if(applicable())void refresh();},30000);
show();void refresh();
