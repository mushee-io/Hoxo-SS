/**
 * M53 — evidence-based, read-only Hoxo Stellar Testnet trading checklist.
 *
 * Only check "passed" if independently observed by the M41 RPC+Horizon probe.
 * Contract SOURCE/CI completion is never treated as a successful signed trade.
 * Registry entries cannot stand in for live deployment/receipt verification.
 * This file never imports a wallet adapter, creates XDR, signs or broadcasts.
 */
import {M41_SPOT_CANDIDATE} from "../activation/m41-spot-asset-readiness.mjs";

const PASS="passed",BLOCKED="blocked",PENDING="pending",UNVERIFIED="unverified";
const ROLES=Object.freeze([
  ["oracle-adapter","Independent XLM perpetual oracle deployed"],
  ["risk-engine","Perpetual risk controller deployed"],
  ["perp-clearinghouse","XLM perpetual clearinghouse deployed"],
  ["unified-margin","Perpetual margin integration deployed"]
]);
const digits=/^(0|[1-9]\d*)$/;
function verdict(id,label,status,reason){
  if(![PASS,BLOCKED,PENDING,UNVERIFIED].includes(status))
    throw Error("invalid acceptance status");
  return Object.freeze({id,label,status,checked:status===PASS,reason});
}
function positiveBalance(wallet,field,minimum=0n){
  return wallet&&typeof wallet[field]==="string"&&digits.test(wallet[field])&&
    BigInt(wallet[field])>minimum;
}
function validM41(p){
  return p?.milestone==="M41"&&p.network==="Stellar Testnet"&&
    p.contractId===M41_SPOT_CANDIDATE.spotContractId&&
    p.baseSac===M41_SPOT_CANDIDATE.baseSac&&
    p.quoteSac===M41_SPOT_CANDIDATE.quoteSac&&
    p.deployedReadOnly===true&&p.wasmHashVerified===true&&
    p.ownerVerified===true&&p.baseTokenDecimals===7&&
    p.quoteTokenDecimals===7&&Array.isArray(p.wallets)&&p.wallets.length===2&&
    p.wallets[0]?.publicKey===M41_SPOT_CANDIDATE.spotOwner&&
    p.wallets[1]?.publicKey===M41_SPOT_CANDIDATE.otherTrader;
}
function registryRole(registry,role){
  if(registry?.network!=="testnet"||
     registry.passphrase!==M41_SPOT_CANDIDATE.networkPassphrase||
     !Array.isArray(registry.contracts))return null;
  const entries=registry.contracts.filter(x=>x?.role===role);
  return entries.length===1?entries[0]:null;
}
export function evaluateM53TestnetTrading({
  m41=null,registry=null,observedAt=new Date().toISOString(),probeError=null
}={}){
  if(!Number.isFinite(Date.parse(observedAt)))throw Error("invalid observation timestamp");
  const trusted=validM41(m41),items=[];
  const add=(id,label,status,reason)=>items.push(verdict(id,label,status,reason));
  add("network","Stellar Testnet network identity",
    trusted?PASS:UNVERIFIED,
    trusted?"Verified M41 network and exact asset/participant identity":
      "A fresh RPC + Horizon Testnet proof is required");
  add("spot_wasm","Deployed M9 settlement binary verified",
    trusted?PASS:UNVERIFIED,
    trusted?"Independent deployed WASM SHA-256 and contract owner verified":
      "Current M9 contract and deployed WASM have not passed a fresh proof");
  const allowed=trusted&&m41.baseAllowed===true&&m41.quoteAllowed===true;
  add("spot_assets","Native XLM and Circle Testnet USDC approved",
    !trusted?UNVERIFIED:allowed?PASS:BLOCKED,
    allowed?"Both seven-decimal contract assets are allowlisted":
      "Exact Soroban asset approvals missing or unverified");
  const wallet1=trusted?m41.wallets[0]:null,wallet2=trusted?m41.wallets[1]:null;
  for(const [number,wallet] of [[1,wallet1],[2,wallet2]]){
    const xlm=positiveBalance(wallet,"xlmE7",10_000_000n);
    const usdc=positiveBalance(wallet,"usdcE7");
    const trust=wallet?.usdcTrustlinePresent===true&&
      wallet?.usdcTrustlineAuthorized===true;
    add("wallet_"+number+"_xlm","Wallet "+number+" native XLM inventory and reserve",
      !trusted?UNVERIFIED:xlm?PASS:BLOCKED,
      xlm?"Exact on-chain Testnet wallet holds more than 1 XLM":
        "Insufficient or unverifiable XLM reserve");
    add("wallet_"+number+"_usdc","Wallet "+number+" authorised USDC trustline and balance",
      !trusted?UNVERIFIED:trust&&usdc?PASS:BLOCKED,
      trust&&usdc?"Exact issuer trustline authorised and funded":
        "Missing or unfunded authorised Circle Testnet USDC trustline");
  }
  const isPaused=trusted?m41.contractPaused:null;
  add("m9_unpaused","M9 spot settlement unpaused on Testnet",
    !trusted||typeof isPaused!=="boolean"?UNVERIFIED:
      isPaused?BLOCKED:PASS,
    isPaused===true?"M9 is intentionally paused; never change automatically":
      isPaused===false?"Contract reports unpaused; still requires security review":
      "A current read-only M9 paused() result is required");
  add("two_wallet_signing","Real independent Freighter approvals for one exact match",
    PENDING,"Wallet 2 Soroban auth and Wallet 1 transaction signature must be verified on the same XDR");
  add("spot_buy_receipt","XLM spot BUY settled and independently reconciled",
    PENDING,"No independently authenticated Testnet M9 BUY receipt and two-wallet balance reconciliation");
  add("spot_sell_receipt","XLM spot SELL settled and independently reconciled",
    PENDING,"No independently authenticated Testnet M9 SELL receipt and two-wallet balance reconciliation");
  add("orderbook_matching","Executable Hoxo spot order matching and settlement",
    PENDING,"External market depth or passing unit tests do not prove Hoxo orders are executable");
  for(const [role,label] of ROLES){
    const entry=registryRole(registry,role);
    // The registry is only a candidate. Even a verified row requires live
    // contract code verification, controller binding and risk acceptance.
    const reason=entry?.status==="verified"&&typeof entry.contractId==="string"?
      "Registry candidate found; independent RPC code/controllers verification still required":
      "No verified deployed "+role+" entry in current Testnet registry";
    add("perp_"+role,label,PENDING,reason);
  }
  add("perp_margin","On-chain, independently verified margin funded for BOTH perp parties",
    PENDING,"Horizon wallet balances do not count as deposited isolated margin");
  add("perp_oracle_risk","Fresh independent oracle, solvency, liquidation and margin risk proof",
    PENDING,"No independent on-chain risk acceptance tied to the deployed clearinghouse");
  add("perp_long_receipt","XLM-PERP LONG opened and reconciled on-chain",
    PENDING,"No independently verified position receipt from deployed Hoxo clearinghouse");
  add("perp_short_receipt","XLM-PERP SHORT opened and reconciled on-chain",
    PENDING,"No independently verified position receipt from deployed Hoxo clearinghouse");
  const counts=Object.freeze({
    total:items.length,
    passed:items.filter(x=>x.status===PASS).length,
    blocked:items.filter(x=>x.status===BLOCKED).length,
    pending:items.filter(x=>x.status===PENDING).length,
    unverified:items.filter(x=>x.status===UNVERIFIED).length
  });
  // Both directions must have independent receipt proof, and the M9 pause
  // gate cannot be bypassed. This evaluator never grants execution.
  const currentCodeReady=trusted&&allowed&&isPaused===false;
  return Object.freeze({
    milestone:"M53",subject:"Hoxo Stellar TESTNET trading only",
    observedAt,readOnly:true,
    source:trusted?"LIVE_M41_READ_ONLY_RPC_HORIZON":"UNVERIFIED_M41",
    probeError:typeof probeError==="string"?probeError.slice(0,220):null,
    counts,items:Object.freeze(items),
    assetPreflightComplete:trusted&&allowed&&
      [wallet1,wallet2].every(x=>positiveBalance(x,"xlmE7",10_000_000n)&&
        positiveBalance(x,"usdcE7")&&x.usdcTrustlineAuthorized===true),
    currentSpotContractUnpaused:trusted&&isPaused===false,
    codePreflightConditionOnly:currentCodeReady,
    spotBuySellOperational:false,
    perpLongShortOperational:false,
    independentlyVerifiedTradingVolumeE7:"0",
    userWalletSignatureStillRequired:true,
    mainnetPermitted:false,
    executionPermitted:false,
    broadcast:false
  });
}
export function formatM53Markdown(report){
  const lines=[
    "# Hoxo-SS — Stellar Testnet trading acceptance",
    "",
    "Read-only evidence snapshot: "+report.observedAt,
    "",
    "Passed "+report.counts.passed+"/"+report.counts.total+
    " · Blocked "+report.counts.blocked+" · Pending "+report.counts.pending+
    " · Unverified "+report.counts.unverified,
    "",
    "Only live RPC/Horizon evidence is automatically checked; a missing trade receipt never becomes a pass.",
    ""
  ];
  if(report.probeError)lines.push("Network probe could not verify current readiness: "+report.probeError,"");
  for(const item of report.items)
    lines.push("- ["+(item.checked?"x":" ")+"] **"+item.label+"** — "+
      item.status.toUpperCase()+"; "+item.reason);
  lines.push("","**Trading activation:** BLOCKED until explicit signing, genuine execution receipts, and contract/security gates pass.",
    "**No transaction signing, unpause, or Vercel deployment is performed by this check.**");
  return lines.join("\n")+"\n";
}
