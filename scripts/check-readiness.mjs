#!/usr/bin/env node
/** CI gate: report actual implementation and refuse premature exchange readiness. */
import {readFile} from "node:fs/promises";
import {validateRegistry} from "../infra/registry.mjs";
import {validateMarketRegistry} from "../marketdata/model.mjs";
import {emptyBook,snapshot} from "../matching/core.mjs";
const root=new URL("../",import.meta.url);
const read=async(path)=>await readFile(new URL(path,root),"utf8");
const registry=validateRegistry(JSON.parse(await read("registry/testnet.json")));
const markets=validateMarketRegistry(JSON.parse(await read("registry/market-data.testnet.json")));
const app=await read("app/index.html");
const risk=await read("contracts/risk-engine/src/lib.rs");
const vault=await read("contracts/collateral-vault/src/lib.rs");
const spot=await read("contracts/spot-settlement/src/lib.rs");
const m9Flow=await read("matching/m9-wallet-settlement.mjs");
const moneyMarket=await read("contracts/money-market/src/lib.rs");
const sandbox=snapshot(emptyBook(),"xlm-usdc-spot");
const invariants={
  noVerifiedExchangeContracts:registry.deployedVerified===0 && registry.candidateContracts===0,
  noApprovedRiskOracle:markets.oracleStatus.startsWith("HALTED") && markets.configured===0,
  uiExecutionDisabled:app.includes('id="tradeButton" class="trade-disabled" disabled'),
  uiCustodyDisabled:app.includes("<button disabled>DEPOSIT</button>") && app.includes("<button disabled>WITHDRAW</button>"),
  sandboxUnsettled:!sandbox.tradingEnabled && !sandbox.settleable && !sandbox.onchain,
  riskExecutionGateDisabled:risk.includes("pub fn authorization_enabled() -> bool { false }") &&
    risk.includes("Err(GateError::NotIntegrated)"),
  vaultAuthenticatedOwner:vault.includes("owner.require_auth()"),
  spotContractStillUndeployed:registry.statuses.some(x=>x.role==="spot-settlement"&&x.status==="planned"&&x.contractId===null),
  spotUsesTestnetNetworkId:spot.includes("fn verify_testnet") && spot.includes("verify_testnet(&e)?"),
  spotRequiresTwoAuthorisations:spot.includes("terms.maker.require_auth()") && spot.includes("terms.taker.require_auth()"),
  spotPausedByDefault:spot.includes('e.storage().instance().set(&Key::Paused,&true)'),
  m9WalletSpendingDisabledByDefault:m9Flow.includes('send=false') &&
    m9Flow.includes('sendAcknowledgement!==M9_SEND_ACK') &&
    m9Flow.includes('needsNonInvokerSigningBy'),
  m10SupplyPoolUndeployed:registry.statuses.some(x=>
    x.role==="money-market"&&x.status==="planned"&&x.contractId===null),
  m10BorrowingHardDisabled:moneyMarket.includes('pub fn borrowing_enabled()->bool{false}')&&
    moneyMarket.includes('Err(PoolError::BorrowingDisabled)'),
  m10WalletAuthRequired:moneyMarket.includes('owner.require_auth()')&&
    moneyMarket.includes('require_testnet(&e)?'),
  m10NoUnverifiedInterest:moneyMarket.includes('borrowed_e7:0')&&
    moneyMarket.includes('supply_index_e7:SCALE'),

};
console.log(JSON.stringify({
 project:"Hoxo-SS",network:"Stellar Testnet",readiness:"NOT_LIVE",
 milestones:{
  M1:"code; hosted visual verification pending",
  M2:"code; automated Chromium verification",
  M3:"code; real Freighter extension acceptance pending",
  M4:"read-only RPC/Horizon verified",
  M5:"market observations + guard; on-chain oracle missing",
  M6:"Soroban source; deployment and real transaction missing",
  M7:"mathematical Soroban preview; atomic enforcement missing",
  M8:"signed matching sandbox; not real fills",
  M9:"compiled contract and signed bilateral SDK operator path; no verified Testnet deployment or real signed settlement",
  M10:"isolated Soroban money-market supply code with preview-only rate model; no active borrow or genuine Testnet deposit",
 },
 invariants
},null,2));
if(Object.values(invariants).some(x=>!x))process.exitCode=1;
