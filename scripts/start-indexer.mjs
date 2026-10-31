#!/usr/bin/env node
/**
 * M19 read-only local Testnet event indexer operator.
 * Default mode is intentionally DISABLED and makes ZERO RPC event requests.
 * Only candidate-observation fixtures can be explicitly enabled after
 * inspecting registry metadata. Candidate != independently verified.
 */
import {resolve} from "node:path";
import {readFile} from "node:fs/promises";
import {validateRegistry} from "../infra/registry.mjs";
import {DurableEventIndex} from "../indexer/store.mjs";
import {RpcLedgerScanner,makeRpcClient} from "../indexer/rpc.mjs";
import {createIndexerApi} from "../indexer/api.mjs";
const registry=JSON.parse(await readFile(
  new URL("../registry/testnet.json",import.meta.url),"utf8"));
const summary=validateRegistry(registry);
const enabled=process.env.HOXO_M19_OBSERVE_CANDIDATES==="YES";
const candidates=registry.contracts.filter(c=>c.status==="candidate");
const port=Number(process.env.HOXO_M19_PORT||"8789");
if(!Number.isSafeInteger(port)||port<1024||port>65535)
  throw Error("Invalid HOXO_M19_PORT");
if(enabled&&candidates.length===0)
  throw Error("M19 observation enabled but no candidate contract in registry");
if(summary.deployedVerified!==0)
  throw Error("M19 candidate-only mode must never claim independently verified contracts");
let store=null,scanner=null,timer=null;
if(enabled){
  const path=resolve(process.env.HOXO_M19_JOURNAL||".data/hoxo-m19-events.jsonl");
  store=await DurableEventIndex.open(path,{contracts:candidates});
  const requested=process.env.HOXO_M19_START_LEDGER;
  const startLedger=requested?Number(requested):null;
  scanner=new RpcLedgerScanner({store,rpc:makeRpcClient(),startLedger});
}
const api=createIndexerApi({store,scanner});
api.listen(port,"127.0.0.1",()=>{
  console.log("HOXO M19 read-only Testnet indexer at http://127.0.0.1:"+port);
  console.log(store?
    "EXPLICIT CANDIDATE OBSERVATION — NOT VERIFIED Hoxo activity":
    "DISABLED — no approved deployed Hoxo contracts; zero event ingestion");
});
if(scanner){
  const poll=async()=>{
    if(scanner.halted)return;
    try{await scanner.poll();}
    catch(error){console.error("M19 HALTED:",String(error.message||error));}
  };
  await poll();
  timer=setInterval(()=>{void poll();},15_000);
}
let stopping=false;
async function shutdown(){
  if(stopping)return;stopping=true;
  if(timer)clearInterval(timer);
  await new Promise(resolveClose=>api.close(resolveClose));
  await store?.close();
}
for(const signal of ["SIGINT","SIGTERM"]){
  process.on(signal,()=>shutdown().then(()=>process.exit(0))
    .catch(e=>{console.error(e);process.exit(1);}));
}
