/**
 * M47 Kraken real external XLM/USD reference candlesticks in Hoxo terminal.
 *
 * No artificial timers that alter price. Candle bars only change on authentic
 * Kraken OHLC/ticker network packets or REST refreshes.
 * NEVER interpret this chart as Hoxo XLM/USDC Testnet execution/pricing.
 */
import {M47_INTERVALS,parseKrakenOhlcMessage,normalizeKrakenCandles,
  mergeRealCandle} from "./m47-live-candles.mjs";

const $=id=>document.getElementById(id);
const canvas=$("m47CandleCanvas");
const surface=$("m47ChartSurface");
const status=$("m47SourceStatus");
const livePrice=$("m47LastPrice");
const priceSource=$("m47LastPriceSource");
const ctx=canvas.getContext("2d");
let current={market:"xlm-usdc-spot",view:"price",timeframe:"30m"};
let candles=[],stream=null,loadSequence=0,loadedAt=0,lastStreamAt=0;
let active=false,refreshBusy=false,stopped=false;
const WATCHED=new Set(["xlm-usdc-spot","xlm-usdc-perp"]);
const EPOCH_MS=60*1000;
function supported(){return WATCHED.has(current.market)&&current.view==="price";}
function label(text){status.textContent=text;}
function price(p){return Number(p).toLocaleString("en-US",{minimumFractionDigits:4,maximumFractionDigits:6});}
function statusText(){
  const latest=candles.at(-1);
  if(!latest)return "EXTERNAL XLM/USD · UNAVAILABLE";
  const stale=Date.now()/1000-latest.time>M47_INTERVALS[current.timeframe]*60*2+90;
  return "KRAKEN XLM/USD · "+current.timeframe.toUpperCase()+
    (stale?" · STALE":Date.now()-lastStreamAt<65000?" · LIVE":" · REFERENCE");
}
function syncPrice(){
  const latest=candles.at(-1);
  if(!latest||!supported())return;
  livePrice.textContent="$"+price(latest.close);
  priceSource.textContent="XLM/USD · KRAKEN REFERENCE";
  $("marketPrice").textContent="$"+price(latest.close);
  label(statusText());
  $("chartMarketStatus").textContent="XLM/USD · KRAKEN SPOT REFERENCE · USD";
}
function clearUI(){
  active=false;
  surface.classList.add("hidden");
  canvas.setAttribute("aria-hidden","true");
  $("chartEmptyTitle").parentElement.classList.remove("hidden");
  livePrice.textContent="—";
  priceSource.textContent="PRICE FEED UNAVAILABLE";
  $("marketPrice").textContent="—";
  if(!supported())label("NO EXTERNAL REFERENCE FOR THIS MARKET / VIEW");
}
function size(){
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  const pixelRatio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.max(1,Math.round(rect.width*pixelRatio));
  canvas.height=Math.max(1,Math.round(rect.height*pixelRatio));
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  return {w:rect.width,h:rect.height};
}
function render(){
  if(!candles.length||!supported())return;
  const dim=size();if(!dim)return;
  const {w,h}=dim;
  ctx.clearRect(0,0,w,h);
  const right=75,left=9,top=18,bottom=35,volumeHeight=Math.max(32,h*.14);
  const chartHeight=h-top-bottom-volumeHeight-8;
  const visibleCount=Math.max(20,Math.min(90,Math.floor((w-right-left)/9)));
  const visible=candles.slice(-visibleCount);
  if(!visible.length)return;
  const min=Math.min(...visible.map(c=>c.low));
  const max=Math.max(...visible.map(c=>c.high));
  const pad=Math.max((max-min)*.14,max*.00008);
  const lo=min-pad,hi=max+pad;
  const y=p=>top+(hi-p)/(hi-lo)*chartHeight;
  const plotWidth=w-right-left;
  const step=plotWidth/visible.length;
  const maxVolume=Math.max(...visible.map(c=>c.volume),1);
  ctx.font="10px monospace";
  ctx.lineWidth=1;
  for(let i=0;i<=5;i++){
    const yy=top+chartHeight*i/5;
    ctx.strokeStyle="rgba(104,123,128,.20)";
    ctx.beginPath();ctx.moveTo(left,yy+.5);ctx.lineTo(w-right,yy+.5);ctx.stroke();
    ctx.fillStyle="#8b9a9e";
    ctx.fillText(price(hi-(hi-lo)*i/5),w-right+8,yy+3);
  }
  const markers=[0,Math.floor(visible.length/4),Math.floor(visible.length/2),
    Math.floor(visible.length*3/4),visible.length-1];
  for(let i=0;i<visible.length;i++){
    const c=visible[i],up=c.close>=c.open;
    const green="#55e4a3",red="#f16b84",color=up?green:red;
    const x=left+(i+.5)*step,body=Math.max(2,step*.61);
    const high=y(c.high),low=y(c.low);
    ctx.strokeStyle=color;ctx.fillStyle=color;
    ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(Math.round(x)+.5,high);ctx.lineTo(Math.round(x)+.5,low);ctx.stroke();
    const bodyTop=Math.min(y(c.open),y(c.close)),bodyH=Math.max(1.7,Math.abs(y(c.close)-y(c.open)));
    ctx.fillRect(x-body/2,bodyTop,body,bodyH);
    const vHeight=volumeHeight*c.volume/maxVolume;
    ctx.fillStyle=up?"rgba(85,228,163,.35)":"rgba(241,107,132,.35)";
    ctx.fillRect(x-body/2,h-bottom-vHeight,body,vHeight);
  }
  const latest=visible.at(-1),yy=y(latest.close),up=latest.close>=latest.open;
  ctx.strokeStyle=up?"#55e4a3":"#f16b84";
  ctx.setLineDash([4,3]);
  ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle=up?"#2b7754":"#843848";
  ctx.fillRect(w-right,yy-11,right,22);
  ctx.font="bold 10px monospace";ctx.fillStyle="#f8fbf4";
  ctx.fillText(price(latest.close),w-right+5,yy+3);
  ctx.font="9px monospace";ctx.fillStyle="#8f9aa4";
  for(const index of new Set(markers)){
    const candle=visible[index];
    const date=new Date(candle.time*1000);
    const mark=current.timeframe==="1d"?
      date.toISOString().slice(5,10):date.toISOString().slice(11,16);
    ctx.fillText(mark,left+Math.max(0,index)*step,h-9);
  }
}
function closeStream(){
  const old=stream;stream=null;
  if(old){old.onopen=null;old.onmessage=null;old.onclose=null;old.onerror=null;
    try{old.close(1000,"switch chart");}catch{}}
}
async function getHistory(interval,sequence){
  const path="/api/market-candles?symbol=XLMUSD&interval="+interval;
  let raw=null;
  try{
    const response=await fetch(path,{cache:"no-store",headers:{Accept:"application/json"}});
    if(!response.ok)throw Error("API proxy not ready");
    const data=await response.json();
    if(data.source!=="Kraken"||data.pair!=="XLM/USD"||data.interval!==interval||
       !Array.isArray(data.candles))throw Error("External reference source mismatch");
    raw=data.candles;
  }catch{
    // Local development / temporarily rate-limited Vercel: try public Kraken.
    try{
      const response=await fetch("https://api.kraken.com/0/public/OHLC?pair=XLMUSD&interval="+interval,
        {cache:"no-store"});
      if(!response.ok)throw Error("Kraken feed unreachable");
      raw=normalizeKrakenCandles(await response.json());
    }catch{return null;}
  }
  if(sequence!==loadSequence||!supported()||stopped)return null;
  const clean=raw.filter(x=>Number.isSafeInteger(x.time)&&
    [x.open,x.high,x.low,x.close,x.volume].every(n=>Number.isFinite(n)&&n>=0)&&
    x.low>0&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close))
    .slice(-220);
  if(clean.length<2)return null;
  candles=clean;loadedAt=Date.now();
  surface.classList.remove("hidden");
  $("chartEmptyTitle").parentElement.classList.add("hidden");
  canvas.setAttribute("aria-hidden","false");
  active=true;syncPrice();render();
  return candles;
}
function openStream(interval,sequence){
  closeStream();
  if(typeof WebSocket!=="function")return;
  let ws;
  try{ws=new WebSocket("wss://ws.kraken.com/");}catch{return;}
  stream=ws;
  ws.onopen=()=>{
    if(sequence!==loadSequence){closeStream();return;}
    ws.send(JSON.stringify({event:"subscribe",pair:["XLM/USD"],
      subscription:{name:"ohlc",interval}}));
  };
  ws.onmessage=event=>{
    if(sequence!==loadSequence||!supported()||stopped)return;
    const point=parseKrakenOhlcMessage(event.data,{pair:"XLM/USD",interval});
    if(!point)return;
    // First REST history is mandatory; a stream snapshot alone is not enough
    // to present the chart as an authentic recent price history.
    if(!candles.length)return;
    const newest=candles.at(-1);
    if(point.time<newest.time-interval*60)return;
    candles=mergeRealCandle(candles,point);
    lastStreamAt=Date.now();
    syncPrice();render();
  };
  ws.onerror=()=>{if(sequence===loadSequence)label(statusText()+" · STREAM INTERRUPTED");};
  ws.onclose=()=>{if(sequence===loadSequence&&stream===ws)stream=null;};
}
async function refresh(){
  if(!supported()||refreshBusy||stopped)return;
  refreshBusy=true;
  const sequence=loadSequence,interval=M47_INTERVALS[current.timeframe];
  try{
    const data=await getHistory(interval,sequence);
    if(!data&&sequence===loadSequence&&candles.length===0){
      label("EXTERNAL MARKET DATA UNAVAILABLE — NO SYNTHETIC CANDLES");
      $("chartEmptyTitle").textContent="EXTERNAL PRICE FEED UNAVAILABLE";
      $("chartEmptyDescription").textContent=
        "Cannot fetch genuine Kraken XLM/USD prices. Hoxo will not invent candlesticks.";
    }
  }finally{refreshBusy=false;}
}
async function reset(next){
  current={...current,...next};
  loadSequence++;
  closeStream();candles=[];lastStreamAt=0;loadedAt=0;
  clearUI();
  if(!supported())return;
  label("LOADING GENUINE KRAKEN XLM/USD MARKET CANDLES...");
  const sequence=loadSequence,interval=M47_INTERVALS[current.timeframe];
  openStream(interval,sequence);
  await refresh();
}
window.addEventListener("hoxo:chart-selection",event=>{reset(event.detail||{});});
window.addEventListener("resize",()=>{if(active)render();});
window.addEventListener("beforeunload",()=>{stopped=true;closeStream();});
window.setInterval(()=>{if(supported()&&!document.hidden)refresh();},45000);
reset({});
