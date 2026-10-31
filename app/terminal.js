/** M3: Read-only network ledger indicator. No wallet access here. */
import {probeTestnet} from "../assets/testnet-status.mjs";
const ledger=document.getElementById("ledgerValue");
const status=document.getElementById("networkStatus");
const clock=document.getElementById("clock");
async function readLedger(){
  const result=await probeTestnet();
  if(result.state==="verified"){
    ledger.textContent="#"+result.ledger.toLocaleString("en-GB");
    status.textContent="STELLAR TESTNET VERIFIED (READ ONLY)";
  }else{
    ledger.textContent="UNAVAILABLE";
    status.textContent="TESTNET "+result.state.toUpperCase()+" · NO EXCHANGE CONTRACTS";
  }
}
function setClock(){clock.textContent=new Date().toISOString().slice(11,19);}
setClock();readLedger();
setInterval(setClock,1000);
setInterval(()=>{if(!document.hidden)readLedger();},30000);
