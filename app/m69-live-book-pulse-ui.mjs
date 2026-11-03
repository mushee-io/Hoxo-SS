/**
 * M69 visual quote pulse from the real Stellar Testnet Classic DEX orderbook.
 * This is a READ-ONLY live PRICE TRACE of resting bids/asks. It must not be
 * mistaken for executed trade candles or Hoxo M9 settlements.
 */
import {checkedM69LiveBook,appendM69Quote} from "./m69-live-book-pulse.mjs";
const $=id=>document.getElementById(id);
const panel=$("m69LiveQuotePanel"),status=$("m69QuoteStatus"),
  canvas=$("m69QuoteSpark"),ctx=canvas.getContext("2d");
let market=new URLSearchParams(location.search).get("market")||"xlm-usdc-spot",
  view="price",source="stellar-dex",loading=false,history=[],epoch=0;
const active=()=>market==="xlm-usdc-spot"&&view==="price"&&source==="stellar-dex";
const pretty=p=>Number(p).toFixed(7);
function shown(){
  const enabled=active();
  panel.classList.toggle("hidden",!enabled);
  if(!enabled){epoch++;history=[];}
}
function trace(){
  if(!active()||!history.length)return;
  const bounds=canvas.getBoundingClientRect(),w=bounds.width,h=bounds.height;
  if(w<50||h<15)return;
  const ratio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const values=history.flatMap(x=>[x.bid,x.ask]);
  const lower=Math.min(...values),upper=Math.max(...values);
  const pad=Math.max(0.0000001,(upper-lower)*.1);
  const lo=lower-pad,hi=upper+pad,left=3,right=w-3;
  const x=i=>left+(history.length===1?.5:i/(history.length-1))*(right-left);
  const y=v=>5+(hi-v)/(hi-lo)*(h-10);
  ctx.lineWidth=1.6;ctx.lineJoin="round";ctx.lineCap="round";
  for(const [side,color] of [["bid","#61e49e"],["ask","#f596a2"]]){
    ctx.strokeStyle=color;ctx.beginPath();
    history.forEach((tick,i)=>{
      if(i===0)ctx.moveTo(x(i),y(tick[side]));
      else ctx.lineTo(x(i),y(tick[side]));
    });
    ctx.stroke();
    const last=history.at(-1);
    ctx.beginPath();ctx.arc(x(history.length-1),y(last[side]),2.5,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();
  }
}
function markUnavailable(){
  status.textContent="LIVE ORDER BOOK UNAVAILABLE · RETRYING";
  status.classList.add("m69-stale");
  $("m69QuoteBid").textContent="—";
  $("m69QuoteAsk").textContent="—";
  $("m69QuoteSpread").textContent="—";
  $("m69Updated").textContent="NO VERIFIED QUOTE";
  history=[];ctx.clearRect(0,0,canvas.width,canvas.height);
}
async function refresh(){
  if(!active()||document.hidden||loading)return;
  loading=true;const ticket=epoch;
  try{
    const result=await fetch("/api/market-orderbook?source=stellar-testnet",{
      method:"GET",cache:"no-store",headers:{accept:"application/json"}
    });
    if(!result.ok)throw Error("Live book temporarily unavailable");
    const verified=checkedM69LiveBook(await result.json());
    if(ticket!==epoch||!active())return;
    history=appendM69Quote(history,verified);
    $("m69QuoteBid").textContent=pretty(verified.bid);
    $("m69QuoteAsk").textContent=pretty(verified.ask);
    $("m69QuoteSpread").textContent=pretty(verified.spread);
    $("m69Updated").textContent=new Date(verified.timestamp)
      .toLocaleTimeString("en-GB",{timeZone:"UTC",hour12:false})+" UTC";
    status.textContent="LIVE · "+history.length+" REAL BOOK SNAPSHOT"+(history.length===1?"":"S");
    status.classList.remove("m69-stale");
    trace();
  }catch{
    if(ticket===epoch&&active())markUnavailable();
  }finally{loading=false;}
}
window.addEventListener("hoxo:market-change",event=>{
  market=event.detail?.market??"";
  shown();if(active())void refresh();
});
window.addEventListener("hoxo:chart-selection",event=>{
  view=event.detail?.view??"price";
  shown();if(active())void refresh();
});
window.addEventListener("hoxo:chart-source",event=>{
  source=event.detail?.source??"hoxo-m9";
  shown();if(active())void refresh();
});
window.addEventListener("resize",()=>{if(active())trace();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void refresh();});
setInterval(()=>{if(active())void refresh();},6000);
shown();void refresh();
