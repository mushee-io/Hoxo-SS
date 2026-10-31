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
const debtModule=await read("contracts/money-market/src/m11.rs");
const perp=await read("contracts/perp-clearinghouse/src/lib.rs");
const funding=await read("contracts/perp-clearinghouse/src/m13.rs");
const liquidation=await read("contracts/perp-clearinghouse/src/m14.rs");
const unified=await read("contracts/unified-margin/src/lib.rs");
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
  m11BorrowingPausedAndZeroCapByDefault:
    debtModule.includes('debt_cap_e7:0') &&
    debtModule.includes('paused:true,risk_authority:None') &&
    moneyMarket.includes('d.risk_authority.clone().ok_or(PoolError::RiskNotConfigured)') &&
    moneyMarket.includes('BorrowRiskClient::new(&e,&risk).approve_borrow'),
  m11BorrowerMustSign:moneyMarket.includes('borrower.require_auth()'),
  m11RepaymentPayerMustSign:moneyMarket.includes('payer.require_auth()'),
  m11NoCrossProductClaims:moneyMarket.includes('pub fn borrow_disabled()->Result<(),PoolError>'),
  m10WalletAuthRequired:moneyMarket.includes('owner.require_auth()')&&
    moneyMarket.includes('require_testnet(&e)?'),
  m10NoUnverifiedInterest:moneyMarket.includes('borrowed_e7:0')&&
    moneyMarket.includes('supply_index_e7:SCALE'),
  m12ContractUnverified:registry.statuses.some(x=>
    x.role==="perp-clearinghouse"&&x.status==="planned"&&x.contractId===null),
  m12StartsPaused:perp.includes('e.storage().instance().set(&Key::Paused,&true)'),
  m12ControllerRequired:perp.includes('has(&Key::Oracle)')&&
    perp.includes('has(&Key::Risk)')&&
    perp.includes('MarginRiskClient::new(&e,&risk).approve_open'),
  m12WalletsMustSign:perp.includes('long.require_auth()')&&
    perp.includes('short.require_auth()')&&
    perp.includes('pos.long.require_auth();pos.short.require_auth()'),
  m12NoUnifiedMarginClaims:perp.includes('ISOLATED bilateral perpetual')&&
    perp.includes('M5 oracle/M7 canonical risk are NOT deployed'),
  m13FeesOffByDefault:funding.includes('fee_bps:0')&&
    perp.includes('totals(&e).open_positions>0'),
  m13FundingNotHistorical:funding.includes('FundingOverdue')&&
    funding.includes('FUNDING_INTERVAL_SEC'),
  m13OnchainPriceRequired:perp.includes('let price=require_price(&e)?')&&
    perp.includes('m13::funding_step(&e,&pos,&q)?'),
  m13FeesSegregated:perp.includes('t.total_user_claims_e7.checked_sub(assessed)')&&
    funding.includes('accrued_fees_e7'),
  m13NoAdminSweep:!perp.includes('pub fn sweep(')&&
    !perp.includes('pub fn collect_fees('),
  m14InsuranceIsPrefunded:liquidation.includes('reserves_e7:0')&&
    perp.includes('funder.require_auth()')&&
    perp.includes('token.transfer(&funder,&vault,&amount_e7)'),
  m14FullLiquidationsFailClosed:liquidation.includes('InsuranceShortfall')&&
    perp.includes('if !snapshot.can_full_liquidate'),
  m14KeeperAuthAndConflictGuard:perp.includes('keeper.require_auth()')&&
    perp.includes('keeper==p.long||keeper==p.short'),
  m14SeparateLiabilities:liquidation.includes('uncovered_bad_debt_e7')&&
    funding.includes('insurance_reserve_e7'),
  m14UnverifiedDeployment:registry.statuses.some(x=>
    x.role==="perp-clearinghouse"&&x.status==="planned"&&x.contractId===null),
  m15Undeployed:registry.statuses.some(x=>
    x.role==="unified-margin"&&x.status==="planned"&&x.contractId===null),
  m15StartsPaused:unified.includes('e.storage().instance().set(&Key::Paused,&true)'),
  m15RiskRequired:unified.includes('MarginRiskClient::new(e,&risk).authorization_enabled()')&&
    unified.includes('approve_reservation('),
  m15OwnerAndAdapterAuthorize:unified.includes('owner.require_auth();')&&
    unified.includes('adapter.require_auth();'),
  m15DoesNotDoubleCount:unified.includes('w.available_e7-=amount;')&&
    unified.includes('w.reserved_e7=w.reserved_e7.checked_add(amount)')&&
    unified.includes('t.user_claims_e7'),
  m15NoFakeYieldOrCrossProductExecution:
    !unified.includes('pub fn borrow(')&&!unified.includes('pub fn open_perp(')&&
    !unified.includes('pub fn atomic_swap('),

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
  M10:"isolated Soroban money-market supply code; no genuine Testnet deposit",
  M11:"indexed debt and repayment added behind unconfigured canonical risk authority and zero cap; no real Testnet borrow",
  M12:"isolated two-wallet perp escrow and PnL contract source; no verified oracle, risk controller or deployment",
  M13:"bounded Soroban mark-index funding, closed-loop fee reserves and reconciliation; no approved oracle or Testnet funding receipts",
  M14:"isolated keeper liquidation, prefunded insurance and potential bad-debt preview; no verified deployment, historical funding recovery or public trading",
  M15:"canonical single-asset shared reservation ledger for spot, perp and lending; not deployed or linked to M9/M11/M12 and blocked by M7 risk gate",
 },
 invariants
},null,2));
if(Object.values(invariants).some(x=>!x))process.exitCode=1;
