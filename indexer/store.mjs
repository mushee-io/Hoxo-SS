/**
 * HOXO M19 durable, hash-linked Soroban RPC observation journal.
 * NO financial state reconstruction, no custody or simulated exchange fills.
 * RPC response is provider-reported evidence only: NOT an independently
 * verified transaction proof. Commit an entire ledger atomically per fsync.
 * Reorg/archival gaps HALT rather than silently deleting a credited amount.
 */
import {open,readFile,mkdir,unlink} from "node:fs/promises";
import {dirname} from "node:path";
import {createHash} from "node:crypto";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {isStellarContractId} from "../infra/registry.mjs";
const HEX=/^[a-f0-9]{64}$/i;
const ID=/^[0-9]{1,32}-[0-9]{1,16}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_EVENTS_PER_LEDGER=2000;
const MAX_RECORDS=250_000;
const EMPTY="0".repeat(64);
const sha=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const fail=message=>{throw Error(message);};
function canonicalBase64(s){
  return typeof s==="string"&&s.length>0&&s.length<=65_536&&BASE64.test(s)&&
    Buffer.from(s,"base64").toString("base64")===s;
}
export function registryFingerprint(contracts){
  if(!Array.isArray(contracts)||contracts.length<1||contracts.length>7)
    fail("M19 explicit nonempty contract allowlist required");
  const sorted=contracts.map(c=>{
    if(!c||typeof c.role!=="string"||!/^[a-z-]+$/.test(c.role)||
       !isStellarContractId(c.contractId))fail("Invalid M19 approved candidate contract");
    return {role:c.role,contractId:c.contractId};
  }).sort((a,b)=>a.role.localeCompare(b.role));
  if(new Set(sorted.map(c=>c.role)).size!==sorted.length||
     new Set(sorted.map(c=>c.contractId)).size!==sorted.length)
    fail("Duplicated M19 contracts");
  return sha({passphrase:TESTNET_PASSPHRASE,contracts:sorted});
}
export function validateEvent(event,ledger,contracts){
  if(!event||event.type!=="contract"||
    !contracts.some(c=>c.contractId===event.contractId))
    fail("Unregistered or non-contract RPC event");
  if(event.ledger!==ledger||!ID.test(event.id||"")||
     !HEX.test(event.txHash||""))
    fail("Invalid event ledger, ID or transaction hash");
  if(event.inSuccessfulContractCall===false)
    fail("Failed-contract-call event is not a settled transaction");
  if(!Array.isArray(event.topic)||event.topic.length<1||
    event.topic.length>4||!event.topic.every(canonicalBase64)||
    !canonicalBase64(event.value))
    fail("Invalid Soroban event XDR payload");
  if(typeof event.ledgerClosedAt!=="string"||!Number.isFinite(Date.parse(event.ledgerClosedAt)))
    fail("Invalid Soroban event close time");
  return Object.freeze({
    type:"contract",id:event.id,ledger,contractId:event.contractId,
    role:contracts.find(c=>c.contractId===event.contractId).role,
    txHash:event.txHash.toLowerCase(),
    ledgerClosedAt:new Date(event.ledgerClosedAt).toISOString(),
    topic:[...event.topic],value:event.value,
    provenance:"STELLAR_RPC_PROVIDER_REPORTED_CANDIDATE",
    txVerifiedIndependently:false,financialStateDerived:false,
    onchainReported:true,
  });
}
function validateBatch(batch,contracts,previous,seen){
  if(!batch||!Number.isSafeInteger(batch.ledger)||batch.ledger<1||
     !HEX.test(batch.ledgerHash||"")||
     typeof batch.closeTime!=="string"||!Number.isFinite(Date.parse(batch.closeTime))||
     !Array.isArray(batch.events)||batch.events.length>MAX_EVENTS_PER_LEDGER)
    fail("Invalid M19 ledger checkpoint");
  if(previous!==null&&batch.ledger!==previous+1)
    fail("M19 ledger sequence gap or replay");
  const local=new Set();
  const events=batch.events.map(e=>{
    const ev=validateEvent(e,batch.ledger,contracts);
    if(seen.has(ev.id)||local.has(ev.id))fail("Duplicate RPC event identifier");
    local.add(ev.id);
    return ev;
  });
  // Preserve provider order and unique cursor identity. Never synthesize an
  // event for an empty ledger; the checkpoint alone marks scanned coverage.
  return {ledger:batch.ledger,ledgerHash:batch.ledgerHash.toLowerCase(),
    closeTime:new Date(batch.closeTime).toISOString(),events};
}
export class DurableEventIndex {
  constructor({path,file,lock,contracts,fingerprint,rows=[],events=[],
    seen=new Set(),lastHash=EMPTY,halted=false}){
    Object.assign(this,{path,file,lock,contracts,fingerprint,rows,events,seen,lastHash,halted});
    this.closed=false;this.queue=Promise.resolve();this.listeners=new Set();
  }
  static async open(path,{contracts}={}){
    if(typeof path!=="string"||!path||path.length>1000)
      fail("M19 journal path required");
    const fingerprint=registryFingerprint(contracts);
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const lock=await open(path+".lock","wx",0o600);
    let file;
    try{
      let data="";
      try{data=await readFile(path,"utf8");}
      catch(e){if(e.code!=="ENOENT")throw e;}
      if(data&&!data.endsWith("\n"))fail("Corrupt M19 checkpoint: incomplete line");
      const lines=data?data.slice(0,-1).split("\n"):[];
      const seen=new Set(),events=[],rows=[];
      let previousHash=EMPTY,prior=null;
      if(lines.length>MAX_RECORDS)fail("M19 indexed ledger capacity exceeded");
      for(const line of lines){
        if(!line||line.length>2_000_000)fail("Corrupt M19 checkpoint line");
        let record;
        try{record=JSON.parse(line);}
        catch{fail("Corrupt M19 JSON checkpoint");}
        const {hash,...unsigned}=record;
        if(unsigned.version!==1||unsigned.previousHash!==previousHash||
           unsigned.sequence!==rows.length+1||
           unsigned.fingerprint!==fingerprint||hash!==sha(unsigned))
          fail("M19 checkpoint hash-chain or contract-set mismatch");
        const batch=validateBatch(unsigned.batch,contracts,prior,seen);
        if(JSON.stringify(batch)!==JSON.stringify(unsigned.batch))
          fail("Noncanonical M19 ledger payload");
        for(const ev of batch.events){seen.add(ev.id);events.push(ev);}
        rows.push(batch);
        prior=batch.ledger;previousHash=hash;
      }
      file=await open(path,"a",0o600);
      return new DurableEventIndex({
        path,file,lock,contracts,fingerprint,rows,events,seen,
        lastHash:previousHash,
      });
    }catch(error){
      await file?.close().catch(()=>{});
      await lock.close().catch(()=>{});
      await unlink(path+".lock").catch(()=>{});
      throw error;
    }
  }
  get checkpoint(){return this.rows.at(-1)||null;}
  get status(){
    return {state:this.halted?"HALTED":this.closed?"CLOSED":"CANDIDATE_OBSERVATION_ONLY",
      provenance:"STELLAR_RPC_PROVIDER_REPORTED_CANDIDATE",
      latestScannedLedger:this.checkpoint?.ledger??null,
      latestScannedHash:this.checkpoint?.ledgerHash??null,
      checkpointCount:this.rows.length,reportedEvents:this.events.length,
      fingerprint:this.fingerprint,
      independentlyVerifiedDeployments:0,
      hoxoFinancialAccountingAvailable:false,
      tradingEnabled:false,executionPermitted:false};
  }
  subscribe(listener){
    if(typeof listener!=="function")fail("Invalid M19 subscription");
    this.listeners.add(listener);
    return ()=>this.listeners.delete(listener);
  }
  async commit(batch){
    if(this.closed||this.halted)fail("M19 journal unavailable");
    const operation=async()=>{
      if(this.closed||this.halted)fail("M19 journal unavailable");
      if(this.rows.length>=MAX_RECORDS||this.events.length+batch.events.length>MAX_RECORDS)
        fail("M19 retention capacity reached, operator recovery required");
      const normalized=validateBatch(batch,this.contracts,this.checkpoint?.ledger??null,this.seen);
      const unsigned={version:1,sequence:this.rows.length+1,
        previousHash:this.lastHash,fingerprint:this.fingerprint,batch:normalized};
      const hash=sha(unsigned);
      try{
        await this.file.writeFile(JSON.stringify({...unsigned,hash})+"\n","utf8");
        await this.file.sync();
      }catch(error){
        this.halted=true;
        throw Error("M19 durable checkpoint write failed; halted: "+error.message);
      }
      this.rows.push(normalized);
      for(const event of normalized.events){this.events.push(event);this.seen.add(event.id);}
      this.lastHash=hash;
      const notification={ledger:normalized.ledger,hash:normalized.ledgerHash,
        eventCount:normalized.events.length,provenance:"CANDIDATE_OBSERVATION_ONLY"};
      for(const listener of this.listeners){
        try{listener(notification);}catch{/* event subscriber must not invalidate commit */}
      }
      return this.status;
    };
    const result=this.queue.then(operation);
    this.queue=result.then(()=>{},()=>{});
    return result;
  }
  listEvents({role=null,contractId=null,limit=25,cursor=0}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||
       !Number.isSafeInteger(cursor)||cursor<0||cursor>MAX_RECORDS)
      fail("Invalid M19 pagination");
    if(role!==null&&!this.contracts.some(c=>c.role===role))
      fail("Unregistered contract role");
    if(contractId!==null&&!this.contracts.some(c=>c.contractId===contractId))
      fail("Unregistered contract ID");
    const filtered=this.events.filter(ev=>
      (role===null||ev.role===role)&&(contractId===null||ev.contractId===contractId));
    const items=filtered.slice(cursor,cursor+limit).map(x=>({...x,topic:[...x.topic]}));
    return {items,nextCursor:cursor+items.length<filtered.length?
      cursor+items.length:null,source:"STELLAR_RPC_PROVIDER_REPORTED_CANDIDATE",
      chainProofAvailable:false,
      settlementDerived:false,executionsEnabled:false};
  }
  async close(){
    if(this.closed)return;
    this.closed=true;
    await this.queue;
    this.listeners.clear();
    await this.file.close();
    await this.lock.close();
    await unlink(this.path+".lock");
  }
}
