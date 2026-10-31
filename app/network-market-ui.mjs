/** M5 - display REAL read-only Horizon Testnet trade observations, never HOXO fills. */
import {loadRecentNetworkTrades} from "../marketdata/horizon.mjs";
import {validateMarketRegistry} from "../marketdata/model.mjs";
const $=id=>document.getElementById(id);
let running=false;
function render(result){
  const container=$("observedActivityRows");container.replaceChildren();
  if(!result||!["observed","empty"].includes(result.state)){
    $("observedActivityState").textContent="Testnet activity unavailable or network cannot be verified.";
    return;
  }
  const records=result.records||[];
  $("observedActivityState").textContent=records.length
    ?"Observed "+records.length+" independent Stellar Testnet trades (not HOXO fills)."
    :"No recent verified network trades returned.";
  for(const trade of records.slice(0,5)){
    const row=document.createElement("div");row.className="observed-activity-row";
    const asset=document.createElement("strong");
    asset.textContent=trade.base+" / "+trade.counter;
    const info=document.createElement("small");
    info.textContent=trade.baseAmount+" / "+trade.counterAmount+" · "+new Date(trade.timestamp).toISOString().slice(11,19)+" UTC";
    row.append(asset,info);container.append(row);
  }
}
async function refresh(){
  if(running)return;
  running=true;
  const btn=$("observedActivityRefresh");
  btn.disabled=true;
  $("observedActivityState").textContent="Verifying Stellar Testnet Horizon...";
  try{
    const response=await fetch("../registry/market-data.testnet.json",{cache:"no-store"});
    if(!response.ok)throw Error("Market registry unavailable");
    const registry=await response.json();
    const gate=validateMarketRegistry(registry);
    if(gate.oracleStatus!=="HALTED: no verified on-chain oracle")
      throw Error("Oracle must remain halted");
    const data=await loadRecentNetworkTrades();
    render(data);
  }catch(error){
    render(null);
  }finally{running=false;btn.disabled=false;}
}
$("observedActivityRefresh").addEventListener("click",refresh);
refresh();
setInterval(()=>{if(!document.hidden)refresh();},60000);
