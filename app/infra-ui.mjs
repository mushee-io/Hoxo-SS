/** M4 network diagnostics view (no transactions, no implied contract readiness). */
import {TESTNET_CONFIG} from "../config/testnet.mjs";
import {probeInfrastructure} from "../infra/network.mjs";
import {validateRegistry} from "../infra/registry.mjs";
const $=id=>document.getElementById(id);
let running=false,lastCheck=0;
$("infraHorizonUrl").textContent=TESTNET_CONFIG.horizon;
$("infraRpcUrl").textContent=TESTNET_CONFIG.rpc;
async function verifyRegistry(){
  const response=await fetch("../registry/testnet.json",{cache:"no-store"});
  if(!response.ok)throw Error("Registry could not be loaded");
  const data=await response.json();
  const result=validateRegistry(data);
  const list=$("infraContractList");list.replaceChildren();
  for(const row of result.statuses){
    const item=document.createElement("div");item.className="infra-contract-row";
    const title=document.createElement("span");title.textContent=row.role.replaceAll("-"," ").toUpperCase();
    const detail=document.createElement("b");
    detail.textContent=row.status==="planned"?"NOT DEPLOYED":"CANDIDATE / UNVERIFIED";
    item.append(title,detail);list.append(item);
  }
  $("infraRegistryStatus").textContent="REGISTRY VALID";
  $("infraVerifiedContracts").textContent=String(result.deployedVerified);
  $("infraRegistryDetail").textContent=result.contractCount+" planned contract roles; "+result.assetCount+" registered native/issued assets. No on-chain deployment verified.";
  return result;
}
function report(id,value){
  $(id+"Status").textContent=value.state==="verified"?"VERIFIED":value.state.toUpperCase();
  $(id+"Ledger").textContent=value.ledger===null?"—":"#"+value.ledger.toLocaleString("en-GB");
  $(id+"Detail").textContent=value.message;
}
async function refresh(){
  if(running)return;
  running=true;
  const btn=$("infraRefresh");btn.disabled=true;
  $("infraOverall").textContent="CHECKING...";
  let registryOK=false,networkOK=false;
  try{
    const [network,registry]=await Promise.allSettled([probeInfrastructure({timeoutMs:12000}),verifyRegistry()]);
    if(registry.status==="fulfilled")registryOK=true;
    else{
      $("infraRegistryStatus").textContent="REGISTRY UNAVAILABLE";
      $("infraRegistryDetail").textContent=String(registry.reason?.message||registry.reason||"Registry check failed");
      $("infraVerifiedContracts").textContent="—";
      $("infraContractList").textContent="Cannot verify contract registry.";
    }
    if(network.status==="fulfilled"){
      report("infraHorizon",network.value.horizon);
      report("infraRpc",network.value.rpc);
      networkOK=network.value.state==="verified";
      $("infraOverallDetail").textContent=network.value.message;
    }else{
      $("infraHorizonStatus").textContent="UNAVAILABLE";
      $("infraRpcStatus").textContent="UNAVAILABLE";
      $("infraOverallDetail").textContent="Browser cannot complete the read-only network check.";
    }
    $("infraOverall").textContent=networkOK&&registryOK?"TESTNET CONNECTED · CONTRACTS NOT DEPLOYED":"NOT VERIFIED";
    lastCheck=Date.now();
  }finally{running=false;btn.disabled=false;}
}
$("infraRefresh").addEventListener("click",refresh);
window.addEventListener("hoxo:view",event=>{
  if(event.detail?.view==="network"&&(Date.now()-lastCheck>15000))refresh();
});
if(window.location.hash==="#network")refresh();
