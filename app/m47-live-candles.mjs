/**
 * M47 real external XLM/USD candlestick feed (Kraken public market data).
 * These are EXTERNAL MAINNET VENUE reference prices, not Hoxo Testnet trades,
 * not XLM/USDC executable quotes and not verified Hoxo fills.
 */
export const M47_INTERVALS=Object.freeze({"1m":1,"30m":30,"1h":60,"4h":240,"1d":1440});
export const M47_PAIR="XLM/USD";
export const M47_REST_PAIR="XLMUSD";
export const M47_CHANNEL="ohlc";

function fail(message){throw Error("M47 candles: "+message);}
function finiteNumber(value,label){
  if(typeof value!=="string"&&typeof value!=="number")fail(label+" must be numeric");
  if(value===""||value===null||!Number.isFinite(Number(value))||Number(value)<=0)
    fail("invalid "+label);
  return Number(value);
}
export function normalizeKrakenCandles(response,{nowSec=Date.now()/1000}={}){
  if(!response||!Array.isArray(response.error)||response.error.length||
     !response.result||typeof response.result!=="object")
    fail("invalid Kraken public OHLC result");
  // Kraken may return legacy XXLMZUSD or normalized XLMUSD. Never accept
  // an unrelated instrument merely because it is the first array in result.
  const keys=["XXLMZUSD","XLMUSD"];
  const matches=keys.filter(key=>Array.isArray(response.result[key]));
  if(matches.length!==1)fail("ambiguous or missing XLM/USD OHLC market data");
  const key=matches[0];
  const data=response.result[key];
  const candles=[];
  for(const row of data){
    if(!Array.isArray(row)||row.length<8)continue;
    const time=Number(row[0]);
    if(!Number.isSafeInteger(time)||time<=0||time>nowSec+300)continue;
    let open,high,low,close,volume;
    try{
      open=finiteNumber(row[1],"open");
      high=finiteNumber(row[2],"high");
      low=finiteNumber(row[3],"low");
      close=finiteNumber(row[4],"close");
      volume=Number(row[6]);
    }catch{continue;}
    if(high<Math.max(open,close,low)||low>Math.min(open,close,high)||
       !Number.isFinite(volume)||volume<0)continue;
    candles.push({time,open,high,low,close,volume});
  }
  const unique=new Map(candles.map(c=>[c.time,c]));
  return [...unique.values()].sort((a,b)=>a.time-b.time).slice(-220);
}
export function parseKrakenOhlcMessage(raw,{pair=M47_PAIR,interval=30}={}){
  let msg;
  try{msg=typeof raw==="string"?JSON.parse(raw):raw;}catch{return null;}
  if(!Array.isArray(msg)||msg.length<4||msg[msg.length-1]!==pair||
     msg[msg.length-2]!==M47_CHANNEL+"-"+interval) return null;
  const row=msg[1];
  if(!Array.isArray(row)||row.length<9)return null;
  const time=Math.floor(Number(row[1])); // candle end timestamp
  const bucket=Math.floor((time-0.001)/(interval*60))*interval*60;
  let open,high,low,close,volume;
  try{
    open=finiteNumber(row[2],"stream open");
    high=finiteNumber(row[3],"stream high");
    low=finiteNumber(row[4],"stream low");
    close=finiteNumber(row[5],"stream close");
    volume=Number(row[7]);
  }catch{return null;}
  if(!Number.isSafeInteger(bucket)||bucket<1||high<Math.max(open,close,low)||
     low>Math.min(open,close,high)||!Number.isFinite(volume)||volume<0)return null;
  return {time:bucket,open,high,low,close,volume};
}
export function mergeRealCandle(candles,candle,{max=220}={}){
  if(!Array.isArray(candles)||!candle||!Number.isSafeInteger(candle.time))
    fail("invalid candle update");
  const map=new Map(candles.map(c=>[c.time,c]));
  // Network messages may be replayed/out of order. Never invent intervening candles.
  if(map.has(candle.time)&&Number(candle.volume)<Number(map.get(candle.time).volume))
    return candles.slice(-max);
  map.set(candle.time,candle);
  return [...map.values()].sort((a,b)=>a.time-b.time).slice(-max);
}
export function validateM47Request({symbol="XLMUSD",interval="30"}={}){
  if(symbol!==M47_REST_PAIR)fail("only vetted XLM/USD reference feed allowed");
  const minutes=Number(interval);
  if(!Object.values(M47_INTERVALS).includes(minutes)||String(minutes)!==String(interval))
    fail("unsupported OHLC interval");
  return {symbol,interval:minutes};
}
