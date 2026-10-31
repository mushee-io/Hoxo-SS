/** Hoxo-SS M3 wallet presentation. No wallet secrets or signing. */
import {createWalletSession,FRIENDBOT} from "./wallet-core.mjs";
import {loadStellarWalletActivity} from "../portfolio/stellar-history.mjs";
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
let transferState={owner:null,rows:[],excluded:[],nextCursor:null,loading:false,error:null,ledger:null};
let transferRequest=0;
async function fetchTransfers(owner,{more=false}={}){
  if(!owner)return;
  if(transferState.loading)return;
  const request=++transferRequest;
  transferState={...transferState,owner,loading:true,error:null};
  renderBalances(controller.snapshot());
  try{
    const next=await loadStellarWalletActivity(owner,{
      fetchImpl:(...args)=>fetch(...args),
      cursor:more?transferState.nextCursor:null,
      limit:20,
    });
    if(request!==transferRequest||controller.snapshot().address!==owner)return;
    transferState={
      owner,rows:more?[...transferState.rows,...next.payments]:next.payments,
      nextCursor:next.nextCursor,ledger:next.observedLedger,
      excluded:more?[...transferState.excluded,...next.excludedOperationTypes]:next.excludedOperationTypes,
      loading:false,error:null,
    };
  }catch(error){
    if(request!==transferRequest)return;
    transferState={...transferState,loading:false,error:String(error?.message||error)};
  }
  renderBalances(controller.snapshot());
}
function showTransferHistory(){
  const section=document.createElement("div");
  section.className="wallet-transfer-history";
  const heading=document.createElement("strong");
  heading.textContent="PUBLIC STELLAR TESTNET PAYMENTS · NOT HOXO TRADES";
  const note=document.createElement("p");
  note.textContent="Horizon-reported payments only. Wallet ownership was checked locally by Freighter. These records are NOT exchange settlements, deposits, PnL, interest or funding.";
  section.append(heading,note);
  if(transferState.loading){
    const pending=document.createElement("p");pending.textContent="Verifying Stellar Testnet ledger and public payment history…";section.append(pending);
  }
  if(transferState.error){
    const err=document.createElement("p");
    err.textContent="TRANSFER HISTORY UNAVAILABLE · "+transferState.error;
    section.append(err);
  }
  if(transferState.rows.length){
    const rows=document.createElement("div");
    rows.className="balance-grid wallet-payment-grid";
    for(const heading of ["DIRECTION","AMOUNT / ASSET","LEDGER / TX"]){
      const cell=document.createElement("div");
      cell.className="balance-head";cell.textContent=heading;rows.append(cell);
    }
    for(const payment of transferState.rows){
      const direction=document.createElement("span");
      direction.textContent=payment.direction;
      const amount=document.createElement("span");
      amount.textContent=payment.amount+" "+payment.code;
      const link=document.createElement("a");
      link.textContent=(payment.ledger===null?"PAYMENT":"#"+payment.ledger)+" · VIEW TX";
      link.href="https://stellar.expert/explorer/testnet/tx/"+payment.txHash;
      link.target="_blank";link.rel="noopener noreferrer";
      rows.append(direction,amount,link);
    }
    section.append(rows);
  }else if(!transferState.loading&&!transferState.error){
    const noRows=document.createElement("p");
    noRows.textContent=transferState.owner?"NO PAYMENT RECORDS ON THIS HORIZON PAGE.":"TRANSFER HISTORY NOT LOADED.";
    section.append(noRows);
  }
  if(transferState.excluded.length){
    const note=document.createElement("p");
    note.textContent=transferState.excluded.length+
      " complex payment-like operations omitted (not classified as simple transfers): "+
      [...new Set(transferState.excluded)].join(", ");
    section.append(note);
  }
  if(transferState.nextCursor&&!transferState.loading){
    const more=document.createElement("button");
    more.type="button";more.textContent="LOAD MORE HORIZON PAYMENTS";
    more.addEventListener("click",()=>fetchTransfers(transferState.owner,{more:true}));
    section.append(more);
  }
  const footer=document.createElement("p");
  footer.className="wallet-balance-meta";
  footer.textContent="PUBLIC NETWORK INDEXER · "+(transferState.ledger?"LEDGER "+transferState.ledger:"UNVERIFIED")+
    " · NO HOXO CONTRACT TRANSACTIONS";
  section.append(footer);
  body.append(section);
}

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
  if(activeTab==="Transfers"){
    if(state.status!=="connected"&&state.status!=="unfunded"){
      heading.textContent="CONNECT A VERIFIED TESTNET WALLET";
      description.textContent="Transfers can only be queried here for the verified connected Freighter account.";
      body.append(heading,description);
      return;
    }
    showTransferHistory();
    return;
  }
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
  if(state.address!==transferState.owner){
    transferRequest++;
    transferState={owner:null,rows:[],excluded:[],nextCursor:null,loading:false,error:null,ledger:null};
  }
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
  const s=controller.snapshot();
  if(activeTab==="Transfers"&&["connected","unfunded"].includes(s.status)&&
     transferState.owner!==s.address)void fetchTransfers(s.address);
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
