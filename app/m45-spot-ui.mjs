/**
 * M45 controlled Testnet signing lab; not the normal Buy/Sell order ticket.
 * All contract reads are live. The M9 pause flag blocks simulation/signing.
 * No transaction broadcast, no wallet seed, no persistence.
 */
import {rpc} from "@stellar/stellar-sdk";
import {M45_CANDIDATE,probeM45TestnetPreflight} from "./m45-spot-preflight.mjs";
import {createM44FreighterBrowserAdapter} from "./m44-freighter-adapter.mjs";
import {createM45SigningLab} from "./m45-signing-lab.mjs";
import {M52_SEND_ACK} from "./m52-testnet-spot-finality.mjs";

const $=id=>document.getElementById(id);
const server=new rpc.Server(M45_CANDIDATE.rpc);
let lab=null,proof=null,busy=false;
const buttons=["m45Check","m45Prepare","m45SignTaker","m45SignMaker"];
function note(message,isError=false){
  const target=$("m45Status");
  target.textContent=message;
  target.classList.toggle("m45-error",isError);
}
function paint(){
  const state=lab?.snapshot();
  const canSimulate=proof?.readyForSimulation===true&&proof.contractPaused===false;
  $("m45Network").textContent=proof?.network??"Not checked";
  $("m45Ledger").textContent=proof?.ledger==null?"—":"#"+proof.ledger;
  $("m45Contract").textContent=proof?.contractPaused===true?
    "PAUSED — SIGNING BLOCKED":proof?.contractPaused===false?
    "UNPAUSED — REVIEW REQUIRED":"NOT VERIFIED";
  $("m45Check").disabled=busy;
  $("m45Prepare").disabled=busy||!canSimulate||!$("m45TermsAck").checked;
  $("m45SignTaker").disabled=busy||state?.phase!=="SIMULATED"||!$("m45TakerAck").checked;
  $("m45SignMaker").disabled=busy||state?.phase!=="TAKER_SIGNED"||!$("m45MakerAck").checked;
  $("m55Submit").disabled=busy||state?.phase!=="SIGNED_NOT_SENT"||
    !$("m55SendAck").checked||$("m55SendPhrase").value!==M52_SEND_ACK;
  $("m45Terms").textContent=state?.phase==="SIMULATED"||state?.phase==="TAKER_SIGNED"||
    state?.phase==="SIGNED_NOT_SENT"?
    $("m45Terms").textContent:"No Soroban transaction simulated or signed.";
  $("m45Phase").textContent=state?.phase??"READ-ONLY";
  $("m45NoSend").textContent=state?.phase==="SETTLED"?
    "ON-CHAIN SETTLEMENT VERIFIED · STELLAR TESTNET":
    state?.phase==="SIGNED_NOT_SENT"?
    "TWO SIGNATURES VERIFIED · EXPLICIT SEND APPROVAL REQUIRED":
    "NO TRANSACTION SENT · STELLAR TESTNET ONLY";
}
function clearSession(){
  if(lab){try{lab.reset();}catch{ /* pending signing cannot be cancelled */ }}
  lab=null;
  $("m45TakerAck").checked=false;
  $("m45MakerAck").checked=false;
  $("m55SendAck").checked=false;
  $("m55SendPhrase").value="";
  $("m55Receipt").textContent="No transaction submitted. Confirmation requires an on-chain M9 receipt and both wallet balance changes.";
  $("m45Terms").textContent="No Soroban transaction simulated or signed.";
  paint();
}
async function run(label,fn){
  if(busy)return;
  busy=true;paint();note(label+"...");
  try{await fn();}
  catch(error){
    clearSession();
    note(String(error?.message||error),true);
  }finally{busy=false;paint();}
}
async function preflight(){
  clearSession();
  proof=await probeM45TestnetPreflight({server,nowMs:Date.now()});
  const blockers=proof.blockers?.length?proof.blockers.join(" · "):"No asset blockers in read-only check.";
  note("LEDGER "+proof.ledger+" · "+blockers+
    " · Even a clean result never authorizes trading.");
}
function requireLab(){
  if(!window.freighterApi)throw Error("Freighter API unavailable. Install/enable Freighter for this browser.");
  if(!lab)lab=createM45SigningLab({
    server,
    adapter:createM44FreighterBrowserAdapter(window.freighterApi)
  });
  return lab;
}
$("m45Check").addEventListener("click",()=>run("Checking live Stellar Testnet",preflight));
$("m45Prepare").addEventListener("click",()=>run("Rechecking and simulating exact settlement",async()=>{
  const engine=requireLab();
  const result=await engine.prepare({
    acknowledged:$("m45TermsAck").checked,
    xlmAmount:$("m45Xlm").value,
    usdcAmount:$("m45Usdc").value,
    side:$("m51SpotSide").value
  });
  const terms=result.terms;
  $("m45Terms").textContent=[
    "INTERNAL BILATERAL TEST ONLY — MANUAL PRICE, NO LIVE QUOTE",
    "Wallet 1 "+(terms.maker_side===0?"SELLS XLM":"BUYS XLM")+": "+terms.maker,
    "Wallet 2 "+(terms.maker_side===0?"BUYS XLM / PAYS USDC":"SELLS XLM / RECEIVES USDC")+": "+terms.taker,
    "Base XLM (7 decimals): "+terms.base_amount,
    "Quote USDC (7 decimals): "+terms.quote_amount,
    "Match ID: "+terms.match_id,
    "Expiry ledger: "+terms.expires_at_ledger,
    "Simulated transaction fee (stroops): "+result.feeStroops,
    "NO TRANSACTION BROADCAST"
  ].join("\n");
  note("SIMULATED ONLY. Review all exact terms, then approve each wallet separately if allowed.");
}));
$("m45SignTaker").addEventListener("click",()=>run("Checking Wallet 2 authorization",async()=>{
  const result=await requireLab().approveTaker({acknowledged:$("m45TakerAck").checked});
  if(result.phase!=="TAKER_SIGNED")throw Error("Wallet 2 signature not verified");
  note("Wallet 2 Soroban authorization verified locally. Switch Freighter to Wallet 1 for envelope review.");
}));
$("m45SignMaker").addEventListener("click",()=>run("Checking Wallet 1 envelope signature",async()=>{
  const result=await requireLab().approveMaker({acknowledged:$("m45MakerAck").checked});
  if(result.phase!=="SIGNED_NOT_SENT")throw Error("Wallet 1 envelope not verified");
  note("Both wallet signatures verified. Review the signed trade, enter the final confirmation phrase, and explicitly authorise the Testnet submission.");
}));
$("m55Submit").addEventListener("click",()=>run("Submitting one explicitly approved Testnet spot settlement",async()=>{
  if(!$("m55SendAck").checked||$("m55SendPhrase").value!==M52_SEND_ACK)
    throw Error("Exact final Testnet consent required");
  const result=await requireLab().submit({acknowledgement:$("m55SendPhrase").value});
  if(result.phase!=="SETTLED"||result.verifiedOnChain!==true||
     !/^[a-f0-9]{64}$/i.test(result.transactionHash??""))
    throw Error("Stellar Testnet settlement not independently verified");
  const target=$("m55Receipt");
  target.replaceChildren();
  target.append(document.createTextNode("ON-CHAIN M9 RECEIPT VERIFIED · LEDGER #"+
    result.settledLedger+" · "));
  const link=document.createElement("a");
  link.href="https://stellar.expert/explorer/testnet/tx/"+result.transactionHash;
  link.target="_blank";link.rel="noopener noreferrer";
  link.textContent="VIEW VERIFIED TESTNET TRANSACTION";
  target.append(link);
  note("XLM/USDC Testnet trade settled and both wallet balance changes independently verified.");
}));
for(const id of ["m45TermsAck","m45TakerAck","m45MakerAck","m55SendAck"]){
  $(id).addEventListener("change",paint);
}
$("m55SendPhrase").addEventListener("input",paint);
for(const id of ["m45Xlm","m45Usdc","m51SpotSide"]){
  $(id).addEventListener("input",()=>{proof=null;clearSession();note("Trade side or amounts changed. Run a fresh Testnet preflight.");});
}
window.addEventListener("hoxo:market-change",event=>{
  proof=null;
  clearSession();
  note("Market changed to "+String(event.detail?.market??"another instrument")+
    ". Previous Testnet signatures and approvals cleared.");
});
$("m45Reset").addEventListener("click",()=>{
  proof=null;clearSession();note("Signing lab reset. No transaction has been broadcast.");
});
paint();

// Bundle Windows-only read-only wallet acceptance alongside the M45 lab.
import "./m46-windows-ui.mjs";
