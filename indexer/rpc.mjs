/**
 * M19 Soroban JSON-RPC read-only ingestion. Candidate-only preview, not a
 * production contract indexer. Strict network handshake, retention/history
 * and ledger hash re-checks. No getEvents if registry has no candidates.
 */
import {TESTNET_CONFIG,TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {registryFingerprint} from "./store.mjs";
const HEX=/^[a-fA-F0-9]{64}$/;
const CURSOR=/^[0-9]{1,32}-[0-9]{1,16}$/;
const MAX_LEDGER_BATCH=5;
const MAX_EVENT_PAGE=100;
const MAX_PAGES=20;
const fail=msg=>{throw Error(msg);};
function recentSeconds(s,nowMs){
  if(typeof s!=="string"||!/^[0-9]{9,12}$/.test(s))return false;
  const age=nowMs-Number(s)*1000;
  return Number.isFinite(age)&&age>=-15_000&&age<=120_000;
}
function timeISO(ts){
  if(typeof ts!=="string"||!/^[0-9]{9,12}$/.test(ts))fail("Invalid ledger close time");
  const n=Number(ts)*1000;
  if(!Number.isFinite(n))fail("Invalid ledger time");
  return new Date(n).toISOString();
}
export function validateIndexerNetwork(network,health,head,nowMs){
  if(network?.passphrase!==TESTNET_PASSPHRASE)
    fail("Stellar RPC Testnet passphrase mismatch");
  if(health?.status!=="healthy"||
    !Number.isSafeInteger(health.oldestLedger)||
    !Number.isSafeInteger(health.latestLedger)||
    !Number.isSafeInteger(head?.sequence)||
    health.oldestLedger<1||
    health.oldestLedger>head.sequence||
    health.latestLedger<head.sequence||
    health.latestLedger-head.sequence>2||
    !recentSeconds(head.closeTime,nowMs))
    fail("Stellar RPC unhealthy, stale or inconsistent ledger head");
  return {latestLedger:head.sequence,oldestLedger:health.oldestLedger};
}
export function makeRpcClient({
  fetchImpl=fetch,url=TESTNET_CONFIG.rpc,
  timeoutMs=12_000
}={}){
  if(typeof fetchImpl!=="function"||url!==TESTNET_CONFIG.rpc)
    fail("M19 RPC requires canonical Stellar Testnet provider");
  let id=0;
  return async (method,params={})=>{
    if(!["getNetwork","getHealth","getLatestLedger","getEvents","getLedgers"].includes(method))
      fail("Unsupported read-only M19 RPC method");
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const requestId=++id;
      const response=await fetchImpl(url,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({jsonrpc:"2.0",id:requestId,method,params}),
        cache:"no-store",signal:controller.signal,
      });
      if(!response?.ok)fail("Stellar RPC HTTP "+String(response?.status));
      const body=await response.json();
      if(!body||body.jsonrpc!=="2.0"||body.id!==requestId||
         body.error||!body.result||typeof body.result!=="object")
        fail("Stellar RPC response identity or JSON-RPC error");
      return body.result;
    }finally{clearTimeout(timer);}
  };
}
export class RpcLedgerScanner {
  constructor({store,rpc,now=Date.now,startLedger=null}={}){
    if(!store||typeof store.commit!=="function"||!Array.isArray(store.contracts)||
       !store.contracts.length||store.fingerprint!==registryFingerprint(store.contracts))
      fail("M19 requires a configured, locked candidate journal");
    if(typeof rpc!=="function"||typeof now!=="function"||
       (startLedger!==null&&(!Number.isSafeInteger(startLedger)||startLedger<1)))
      fail("Invalid M19 scanner configuration");
    this.store=store;this.rpc=rpc;this.now=now;
    this.startLedger=startLedger;
    this.halted=false;this.reason=null;this.busy=false;
  }
  get status(){
    return {...this.store.status,scannerHalted:this.halted,
      scannerReason:this.reason,ingestionMode:"CANDIDATE_ONLY_DISABLED_BY_DEFAULT"};
  }
  async ledgerHash(sequence){
    const result=await this.rpc("getLedgers",{startLedger:sequence,pagination:{limit:1}});
    if(!Array.isArray(result.ledgers)||result.ledgers.length!==1||
       result.ledgers[0].sequence!==sequence||
       !HEX.test(result.ledgers[0].hash||""))fail("Missing or invalid ledger hash anchor");
    return {hash:result.ledgers[0].hash.toLowerCase(),
      closeTime:timeISO(result.ledgers[0].ledgerCloseTime)};
  }
  async eventBatch(sequence,head){
    const contracts=this.store.contracts.map(c=>c.contractId);
    let cursor=null,pages=0;
    const events=[];
    while(true){
      if(++pages>MAX_PAGES)fail("RPC event pagination capacity exceeded");
      const params=cursor?
        {filters:[{type:"contract",contractIds:contracts}],pagination:{limit:MAX_EVENT_PAGE,cursor}}:
        {startLedger:sequence,endLedger:sequence+1,
          filters:[{type:"contract",contractIds:contracts}],pagination:{limit:MAX_EVENT_PAGE}};
      // The Stellar RPC contract explicitly disallows startLedger when a
      // cursor is passed; no remote hrefs are ever followed.
      if(cursor)delete params.filters;
      const result=await this.rpc("getEvents",params);
      if(!Array.isArray(result.events)||
         !Number.isSafeInteger(result.oldestLedger)||
         !Number.isSafeInteger(result.latestLedger)||
         result.oldestLedger>sequence||result.latestLedger<sequence||
         result.latestLedger>head+2||
         result.events.length>MAX_EVENT_PAGE)
        fail("Untrusted or incomplete RPC event coverage");
      for(const e of result.events){
        if(e.ledger!==sequence)fail("RPC event crosses requested ledger boundary");
        events.push(e);
      }
      if(events.length>2000)fail("RPC event cap per ledger");
      if(result.events.length<MAX_EVENT_PAGE)break;
      if(typeof result.cursor!=="string"||!CURSOR.test(result.cursor)||
         result.cursor===cursor)fail("RPC event cursor did not advance");
      cursor=result.cursor;
    }
    return events;
  }
  async poll(){
    if(this.halted||this.busy||this.store.closed||this.store.halted)
      fail("M19 scanner halted, closed or concurrent poll");
    this.busy=true;
    try{
      const network=await this.rpc("getNetwork");
      if(network?.passphrase!==TESTNET_PASSPHRASE)
        fail("Stellar RPC Testnet passphrase mismatch");
      const [health,latest]=await Promise.all([
        this.rpc("getHealth"),this.rpc("getLatestLedger")
      ]);
      const {latestLedger,oldestLedger}=validateIndexerNetwork(
        network,health,latest,this.now());
      const checkpoint=this.store.checkpoint;
      if(checkpoint){
        if(checkpoint.ledger<oldestLedger)fail("M19 checkpoint fell outside RPC retention");
        if(checkpoint.ledger>latestLedger)fail("M19 ledger rewind / Testnet reset detected");
        const anchor=await this.ledgerHash(checkpoint.ledger);
        if(anchor.hash!==checkpoint.ledgerHash)
          fail("M19 ledger hash divergence: operator reconciliation required");
      }
      let sequence=checkpoint?checkpoint.ledger+1:
        this.startLedger??latestLedger;
      if(sequence<oldestLedger)fail("M19 requested backfill is outside RPC history");
      if(sequence>latestLedger)return this.status;
      const end=Math.min(latestLedger,sequence+MAX_LEDGER_BATCH-1);
      for(;sequence<=end;sequence++){
        const anchor=await this.ledgerHash(sequence);
        const events=await this.eventBatch(sequence,latestLedger);
        // Re-check after reading events: fail if ledgers changed mid-scan.
        const recheck=await this.ledgerHash(sequence);
        if(anchor.hash!==recheck.hash||anchor.closeTime!==recheck.closeTime)
          fail("Ledger changed during M19 event scan");
        await this.store.commit({
          ledger:sequence,ledgerHash:anchor.hash,
          closeTime:anchor.closeTime,events,
        });
      }
      return this.status;
    }catch(error){
      this.halted=true;
      this.reason=String(error.message||error);
      throw error;
    }finally{this.busy=false;}
  }
}
