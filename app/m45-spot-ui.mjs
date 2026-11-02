/**
 * M45 controlled Testnet signing lab; not the normal Buy/Sell order ticket.
 * All contract reads are live. The M9 pause flag blocks simulation/signing.
 * No transaction broadcast, no wallet seed, no persistence.
 */
import {rpc} from "@stellar/stellar-sdk";
import {M45_CANDIDATE,probeM45TestnetPreflight} from "./m45-spot-preflight.mjs";
import {createM44FreighterBrowserAdapter} from "./m44-freighter-adapter.mjs";
import {createM45SigningLab} from "./m45-signing-lab.mjs";

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
  $("m45Terms").textContent=state?.phase==="SIMULATED"||state?.phase==="TAKER_SIGNED"||
    state?.phase==="SIGNED_NOT_SENT"?
    $("m45Terms").textContent:"No Soroban transaction simulated or signed.";
  $("m45Phase").textContent=state?.phase??"READ-ONLY";
  $("m45NoSend").textContent=state?.phase==="SIGNED_NOT_SENT"?
    "SIGNATURES VERIFIED IN MEMORY ONLY · NO TRANSACTION SENT":
    "NO BROADCAST PATH · NO MAINNET · NO EXCHANGE ORDER";
}
function clearSession(){
  if(lab){try{lab.reset();}catch{ /* pending signing cannot be cancelled */ }}
  lab=null;
  $("m45TakerAck").checked=false;
  $("m45MakerAck").checked=false;
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
    usdcAmount:$("m45Usdc").value
  });
  const terms=result.terms;
  $("m45Terms").textContent=[
    "INTERNAL BILATERAL TEST ONLY — MANUAL PRICE, NO LIVE QUOTE",
    "Maker (sells XLM): "+terms.maker,
    "Taker (pays USDC): "+terms.taker,
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
  note("Both Testnet signatures cryptographically verified in memory. NOT SENT. No Hoxo trade or receipt exists.");
}));
for(const id of ["m45TermsAck","m45TakerAck","m45MakerAck"]){
  $(id).addEventListener("change",paint);
}
for(const id of ["m45Xlm","m45Usdc"]){
  $(id).addEventListener("input",()=>{proof=null;clearSession();note("Amounts changed. Run a fresh Testnet preflight.");});
}
$("m45Reset").addEventListener("click",()=>{
  proof=null;clearSession();note("Signing lab reset. No transaction has been broadcast.");
});
paint();

// Bundle Windows-only read-only wallet acceptance alongside the M45 lab.
import "./m46-windows-ui.mjs";
