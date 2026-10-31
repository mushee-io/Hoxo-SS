/** Hoxo-SS M3 wallet presentation. No wallet secrets or signing. */
import {createWalletSession,FRIENDBOT} from "./wallet-core.mjs";
const $=id=>document.getElementById(id);
const status=$("walletStatus");
const button=$("walletButton");
const address=$("accountAddress");
const faucet=$("faucetButton");
const confirm=$("faucetConfirm");
const refresh=$("refreshWallet");
const copy=$("copyWallet");
const explorer=$("walletExplorer");
const body=$("portfolioBody");
let activeTab="Balances";
let busy=false;

const controller=createWalletSession({
  api:window.freighterApi,
  fetchImpl:(...args)=>fetch(...args),
  onChange:render
});
function notify(message){
  const toast=$("toast");
  toast.textContent=message;
  toast.classList.remove("hidden");
  clearTimeout(notify.timer);
  notify.timer=setTimeout(()=>toast.classList.add("hidden"),6500);
}
const short=str=>str.slice(0,8)+"…"+str.slice(-8);
function renderBalances(state){
  body.replaceChildren();
  const heading=document.createElement("strong"),description=document.createElement("p");
  if(activeTab!=="Balances"){
    heading.textContent=activeTab.toUpperCase()+" · NOT DEPLOYED";
    description.textContent="Trading positions, lending, margin and order history require verified on-chain protocol deployments.";
    body.append(heading,description);
    return;
  }
  if(state.status!=="connected"&&state.status!=="unfunded"){
    heading.textContent=state.status==="wrong-network"?"WRONG STELLAR NETWORK":"NO VERIFIED TESTNET WALLET BALANCES";
    description.textContent=state.message;
    body.append(heading,description);
    return;
  }
  if(state.status==="unfunded"){
    heading.textContent="TESTNET ACCOUNT NOT FUNDED";
    description.textContent="Confirm a Friendbot funding request in the account panel to activate this public address on Testnet.";
    body.append(heading,description);
    return;
  }
  const columns=["ASSET","WALLET BALANCE","ISSUER / TRUSTLINE"];
  const grid=document.createElement("div");
  grid.className="balance-grid";
  columns.forEach(label=>{
    const cell=document.createElement("div");cell.className="balance-head";cell.textContent=label;grid.append(cell);
  });
  state.balances.forEach(b=>{
    [b.asset,b.balance,b.issuer==="Native Stellar asset"?"NATIVE":short(b.issuer)].forEach(label=>{
      const cell=document.createElement("div");cell.textContent=label;grid.append(cell);
    });
  });
  if(state.balances.length===0){
    heading.textContent="NO HORIZON BALANCES RETURNED";
    body.append(heading);
  }else body.append(grid);
  description.className="wallet-balance-meta";
  description.textContent="HORIZON TESTNET · LEDGER "+state.ledger+" · WALLET HOLDINGS ONLY · NOT SPENDABLE MARGIN";
  body.append(description);
}
function render(state){
  const connected=["connected","unfunded"].includes(state.status);
  const pending=["connecting","loading","funding"].includes(state.status);
  const hasAddress=typeof state.address==="string"&&state.address.startsWith("G");
  const hasVerified=connected&&hasAddress;
  status.textContent=state.status.toUpperCase().replace("-"," ")+" · "+state.message;
  status.classList.toggle("warning",state.status==="unfunded"||pending);
  status.classList.toggle("error",state.status==="error"||state.status==="wrong-network");
  button.textContent=hasAddress?"DISCONNECT "+short(state.address):pending?"CHECKING WALLET...":"CONNECT FREIGHTER";
  button.disabled=pending;
  address.textContent=hasAddress?state.address:"No verified Testnet wallet connected";
  refresh.disabled=!hasVerified;
  copy.disabled=!hasVerified;
  faucet.disabled=state.status!=="unfunded";
  if(state.status!=="unfunded")confirm.classList.add("hidden");
  explorer.classList.toggle("hidden",!hasVerified);
  if(hasVerified)explorer.href="https://stellar.expert/explorer/testnet/account/"+encodeURIComponent(state.address);
  renderBalances(state);
}
function withButton(label,run){
  if(busy)return;
  busy=true;
  run().catch(error=>notify(label+": "+String(error.message||error))).finally(()=>{busy=false;});
}
button.addEventListener("click",()=>{
  if(busy)return;
  const state=controller.snapshot();
  if(state.address){controller.disconnect();notify("Wallet session cleared from Hoxo-SS.");}
  else withButton("Wallet",()=>controller.connect());
});
refresh.addEventListener("click",()=>withButton("Refresh",()=>controller.refresh()));
copy.addEventListener("click",()=>withButton("Copy address",async()=>{
  const state=controller.snapshot();
  if(!state.address||!["connected","unfunded"].includes(state.status))return;
  if(!navigator.clipboard?.writeText)throw new Error("Clipboard unavailable in this browser.");
  await navigator.clipboard.writeText(state.address);
  notify("Stellar Testnet wallet address copied.");
}));
faucet.addEventListener("click",()=>{
  if(controller.snapshot().status!=="unfunded")return;
  confirm.classList.remove("hidden");
  $("confirmFaucet").focus();
});
$("cancelFaucet").addEventListener("click",()=>confirm.classList.add("hidden"));
$("confirmFaucet").addEventListener("click",()=>{
  confirm.classList.add("hidden");
  withButton("Friendbot",async()=>{
    await controller.fund();
    const result=controller.snapshot();
    notify(result.status==="connected"?"Testnet account funded and verified on Horizon.":result.message);
  });
});
document.querySelectorAll("[data-portfolio-tab]").forEach(tab=>tab.addEventListener("click",()=>{
  activeTab=tab.dataset.portfolioTab;
  document.querySelectorAll("[data-portfolio-tab]").forEach(button=>button.classList.toggle("active",button===tab));
  renderBalances(controller.snapshot());
}));
window.addEventListener("focus",()=>{const s=controller.snapshot();if(s.address&&!busy)withButton("Wallet recheck",()=>controller.refresh());});
document.addEventListener("visibilitychange",()=>{
  const s=controller.snapshot();
  if(!document.hidden&&s.address&&!busy)withButton("Wallet recheck",()=>controller.refresh());
});
setInterval(()=>{
  const s=controller.snapshot();
  if(!document.hidden&&s.address&&!busy)withButton("Wallet recheck",()=>controller.refresh());
},30000);
render(controller.snapshot());
