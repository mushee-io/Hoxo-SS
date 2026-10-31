/**
 * M19 local read-only HTTP + Server-Sent Events checkpoint stream.
 * NO trading/custody routes, wallet auth, Hoxo financial projections or
 * synthetic market feed. SSE is not WebSocket; that remains future work.
 */
import {createServer} from "node:http";
import {URL} from "node:url";
const DEFAULT_STATUS={
  state:"DISABLED_NO_VERIFIED_DEPLOYMENTS",
  latestScannedLedger:null,reportedEvents:0,
  independentlyVerifiedDeployments:0,
  reason:"No independently verified Hoxo contract deployed; candidate observation disabled",
  hoxoFinancialAccountingAvailable:false,
  tradingEnabled:false,executionPermitted:false,
};
function reply(res,status,data){
  res.writeHead(status,{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store, max-age=0",
    "x-content-type-options":"nosniff",
    "x-robots-tag":"noindex",
  });
  res.end(JSON.stringify(data));
}
function boundedNumber(value,fallback,{min,max}){
  if(value===null)return fallback;
  if(!/^(0|[1-9][0-9]{0,5})$/.test(value))throw Error("Invalid indexer pagination");
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<min||number>max)
    throw Error("Invalid indexer pagination");
  return number;
}
export function createIndexerApi({
  store=null,scanner=null,now=Date.now,rateLimit=120,
}={}){
  let streams=0;
  const visitorHits=new Map();
  return createServer((req,res)=>{
    const ip=req.socket.remoteAddress||"unknown",at=now();
    const window=visitorHits.get(ip);
    if(!window||at-window.at>=60_000)visitorHits.set(ip,{at,count:1});
    else window.count+=1;
    if(visitorHits.get(ip).count>rateLimit){
      reply(res,429,{error:"Rate limited",tradingEnabled:false});
      return;
    }
    try{
      const url=new URL(req.url,"http://127.0.0.1");
      if(req.method!=="GET"){
        reply(res,405,{error:"M19 indexer API is READ_ONLY",tradingEnabled:false});
        return;
      }
      const status=()=>scanner?scanner.status:store?store.status:DEFAULT_STATUS;
      if(["/health","/v1/indexer/status"].includes(url.pathname)){
        reply(res,200,{...status(),api:"READ_ONLY_SSE_NO_WEBSOCKET",
          network:"STELLAR_TESTNET",contractEventsIndexed:!!store,
          noSyntheticMarketData:true});
        return;
      }
      if(url.pathname==="/v1/indexer/events"){
        if(!store){
          reply(res,200,{items:[],nextCursor:null,source:"DISABLED",
            reason:"NO_APPROVED_DEPLOYED_CONTRACTS",
            hoxoFinancialAccountingAvailable:false,tradingEnabled:false});
          return;
        }
        const query={
          role:url.searchParams.get("role"),
          contractId:url.searchParams.get("contractId"),
          limit:boundedNumber(url.searchParams.get("limit"),25,{min:1,max:100}),
          cursor:boundedNumber(url.searchParams.get("cursor"),0,{min:0,max:250000}),
        };
        reply(res,200,{...store.listEvents(query),hoxoFinancialAccountingAvailable:false});
        return;
      }
      if(url.pathname==="/v1/indexer/checkpoints"){
        if(!store){
          reply(res,200,{items:[],nextCursor:null,source:"DISABLED"});
          return;
        }
        const limit=boundedNumber(url.searchParams.get("limit"),25,{min:1,max:100});
        const cursor=boundedNumber(url.searchParams.get("cursor"),0,{min:0,max:250000});
        const items=store.rows.slice(cursor,cursor+limit).map(({ledger,ledgerHash,closeTime,events})=>({
          ledger,ledgerHash,closeTime,reportedEventCount:events.length,
          provenance:"RPC_HEADER_AND_EVENTS_PROVIDER_REPORTED",
        }));
        reply(res,200,{items,nextCursor:cursor+items.length<store.rows.length?
          cursor+items.length:null,independentlyVerified:false});
        return;
      }
      if(url.pathname==="/v1/indexer/stream"){
        if(!store){
          reply(res,200,{stream:"DISABLED",reason:"NO_APPROVED_DEPLOYED_CONTRACTS"});
          return;
        }
        if(streams>=16){
          reply(res,429,{error:"SSE subscriber capacity exceeded"});
          return;
        }
        streams+=1;
        res.writeHead(200,{
          "content-type":"text/event-stream; charset=utf-8",
          "cache-control":"no-store, no-transform",
          "connection":"keep-alive",
          "x-accel-buffering":"no",
          "x-content-type-options":"nosniff",
        });
        const send=(event,data)=>{
          if(!res.destroyed)res.write("event: "+event+"\ndata: "+JSON.stringify(data)+"\n\n");
        };
        send("status",{...status(),tradingEnabled:false});
        const unsubscribe=store.subscribe(batch=>send("checkpoint",batch));
        const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(": heartbeat\n\n");},20_000);
        let closed=false;
        const stop=()=>{
          if(closed)return;closed=true;
          streams-=1;
          clearInterval(heartbeat);unsubscribe();
        };
        res.on("close",stop);
        return;
      }
      reply(res,404,{error:"Not found",tradingEnabled:false});
    }catch(error){
      reply(res,400,{error:String(error.message||error),
        tradingEnabled:false,hoxoFinancialAccountingAvailable:false});
    }
  });
}
