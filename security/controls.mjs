/**
 * M20 process-local, least-privilege controls for Hoxo Testnet.
 * No HTTP operator endpoint, secrets, or on-chain authorization.
 */
export class SecurityGateError extends Error {
  constructor(message) {super(message);this.name="SecurityGateError";this.httpStatus=503;}
}
const SCOPES=["sandbox","oracle","indexer"];
const PRICE_COMMANDS=new Set(["place","replace","advanced_place","sandbox_tick"]);
const CANCELS=new Set(["cancel","advanced_cancel"]);
export function createM20Controls({sandboxPaused=true,oraclePaused=true,indexerPaused=true}={}){
  for(const flag of [sandboxPaused,oraclePaused,indexerPaused])
    if(typeof flag!=="boolean")throw Error("M20 pause flags must be boolean");
  const state={sandbox:sandboxPaused,oracle:oraclePaused,indexer:indexerPaused};
  let revision=0;
  const gate=Object.freeze({
    status:()=>Object.freeze({
      policy:"M20_PROCESS_LOCAL_FAIL_CLOSED",revision,
      sandboxPaused:state.sandbox,oraclePaused:state.oracle,
      indexerPaused:state.indexer,executionPermitted:false,
      tradingEnabled:false,operatorEndpoint:"NONE",
      oracleSource:"NO_APPROVED_CANONICAL_ORACLE",
    }),
    canObserve:()=>!state.indexer,
    assertSandboxCommand(command){
      // Authenticated cancellations remain possible during an outage.
      if(CANCELS.has(command?.type))return true;
      if(state.sandbox)throw new SecurityGateError("M20 sandbox writes paused");
      if(state.oracle&&PRICE_COMMANDS.has(command?.type))
        throw new SecurityGateError("M20 oracle circuit breaker active");
      return true;
    },
  });
  // Only server-local code receives this capability. Never return it on HTTP.
  const operator=Object.freeze({
    setPause(scope,paused,reason){
      if(!SCOPES.includes(scope)||typeof paused!=="boolean"||
         typeof reason!=="string"||reason.trim().length<8||reason.length>300)
        throw Error("Invalid M20 operator pause change");
      state[scope]=paused;revision++;
      return gate.status();
    },
  });
  return Object.freeze({gate,operator});
}
/** Bounded per-socket and global fixed-window rate limiter; never trust proxy headers. */
export function createRequestLimiter({
  perKeyLimit=60,globalLimit=3000,maxKeys=2048,windowMs=60000,
}={}){
  for(const n of [perKeyLimit,globalLimit,maxKeys,windowMs])
    if(!Number.isSafeInteger(n)||n<1)throw Error("Invalid M20 rate budget");
  const hits=new Map();
  let global={start:null,count:0},lastTime=0;
  return Object.freeze({
    take(key,nowMs=Date.now()){
      if(typeof key!=="string"||!key||!Number.isFinite(nowMs))
        return {allowed:false,retryAfterSeconds:60};
      const at=Math.max(nowMs,lastTime);lastTime=at;
      if(global.start===null||at-global.start>=windowMs)
        global={start:at,count:0};
      let current=hits.get(key);
      if(!current||at-current.start>=windowMs){
        if(!current&&hits.size>=maxKeys){
          for(const [k,v] of hits)if(at-v.start>=windowMs)hits.delete(k);
          if(hits.size>=maxKeys)return {allowed:false,retryAfterSeconds:60};
        }
        current={start:at,count:0};hits.set(key,current);
      }
      global.count++;current.count++;
      if(global.count>globalLimit||current.count>perKeyLimit)
        return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil(
          Math.max(global.start+windowMs-at,current.start+windowMs-at)/1000))};
      return {allowed:true,retryAfterSeconds:0};
    },
    get trackedClients(){return hits.size;},
  });
}
