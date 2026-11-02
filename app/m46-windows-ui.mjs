/**
 * M46 — read-only Windows Freighter QA panel.
 * Explicit clicks ONLY: official getAddress/getNetwork + public RPC/Horizon
 * reads. This file does not access the signing adapter or submit a transaction.
 */
import {rpc} from "@stellar/stellar-sdk";
import {createM46WindowsAcceptance} from "./m46-windows-acceptance.mjs";
import {M45_CANDIDATE,probeM45TestnetPreflight} from "./m45-spot-preflight.mjs";

const $=id=>document.getElementById(id);
const server=new rpc.Server(M45_CANDIDATE.rpc);
let session=null,busy=false;
function write(message,error=false){
  const target=$("m46Status");
  target.textContent=message;
  target.classList.toggle("m45-error",error);
}
function draw(){
  const info=session?.summary();
  $("m46Wallet1").textContent=info?.wallet1Verified?"VERIFIED (READ ONLY)":"NOT CHECKED";
  $("m46Wallet2").textContent=info?.wallet2Verified?"VERIFIED (READ ONLY)":"NOT CHECKED";
  $("m46Combined").textContent=info?.bothWalletsReviewed?"BOTH VERIFIED · NO TRADES":"PENDING";
  const enabled=!busy&&$("m46WindowsAck").checked;
  $("m46VerifyWallet1").disabled=!enabled;
  $("m46VerifyWallet2").disabled=!enabled;
  $("m46Reset").disabled=busy;
}
function ensureSession(){
  if(!window.freighterApi||typeof window.freighterApi.getAddress!=="function"||
     typeof window.freighterApi.getNetwork!=="function")
    throw Error("Official Freighter extension is not available on this browser");
  if(!session)session=createM46WindowsAcceptance({
    api:window.freighterApi,
    probe:()=>probeM45TestnetPreflight({server,nowMs:Date.now()})
  });
  return session;
}
async function verify(role){
  if(busy)return;
  busy=true;draw();write("Checking the selected Freighter account and fresh Testnet contract state...");
  try{
    if(!$("m46WindowsAck").checked)throw Error("Windows/Testnet acknowledgement required");
    const state=await ensureSession().verify(role);
    if(state.signatureRequested!==false||state.broadcast!==false)throw Error("Unexpected write capability");
    const label=role==="wallet1"?"Wallet 1":"Wallet 2";
    write(label+" VERIFIED on Testnet ledger #"+state.ledger+
      " · XLM "+state.xlmE7+" (e7) · USDC "+state.usdcE7+
      " (e7) · M9 paused. NO TRANSACTION SIGNED. "+
      (session.summary().bothWalletsReviewed?
        "Both wallets reviewed. This does not permit trading.":
        "Now switch to the other wallet and verify separately."));
  }catch(error){
    session=null;
    write(String(error?.message||error)+" · No signature was requested.",true);
  }finally{busy=false;draw();}
}
$("m46WindowsAck").addEventListener("change",draw);
$("m46VerifyWallet1").addEventListener("click",()=>verify("wallet1"));
$("m46VerifyWallet2").addEventListener("click",()=>verify("wallet2"));
$("m46Reset").addEventListener("click",()=>{
  if(busy)return;
  session=null;
  $("m46WindowsAck").checked=false;
  write("Windows wallet checks cleared. No transaction was signed or submitted.");
  draw();
});
draw();
