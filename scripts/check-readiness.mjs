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
const analytics=await read("crates/risk-math/src/m16.rs");
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
const advanced=await read("matching/advanced.mjs");
const matchingCore=await read("matching/core.mjs");
const advancedAuth=await read("matching/auth.mjs");
const matchingJournal=await read("matching/journal.mjs");
const walletHistory=await read("portfolio/stellar-history.mjs");
const sandboxHistory=await read("portfolio/sandbox-history.mjs");
const portfolioUI=await read("app/wallet-ui.mjs");
const portfolioServer=await read("matching/http.mjs");
const m19Store=await read("indexer/store.mjs");
const m19Rpc=await read("indexer/rpc.mjs");
const m19Api=await read("indexer/api.mjs");
const m19Runner=await read("scripts/start-indexer.mjs");
const m22Gate=await read("security/m22-review.mjs");
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
  m16ReadOnlyAnalytics:analytics.includes('pub fn analyze(')&&
    analytics.includes('pub fn stress(')&&
    analytics.includes('pub fn check_caps(')&&
    analytics.includes('pub fn estimate_liquidation('),
  m16NoCanonicalAuthorization:risk.includes('pub fn authorization_enabled() -> bool { false }')&&
    risk.includes('execution_permitted:false')&&
    risk.includes('pub fn preview_analytics(')&&
    risk.includes('pub fn preview_liquidation('),
  m16FailClosedStress:analytics.includes('RiskError::StalePrice')||
    (analytics.includes('evaluate(portfolio,policy,now)?')&&
    analytics.includes('MAX_STRESS_BPS')),
  m17OrderIntentsSigned:advancedAuth.includes('HOXO-SS-M17-SANDBOX-INTENT-V1')&&
    advancedAuth.includes('advanced_place')&&advancedAuth.includes('sandbox_tick'),
  m17PriceOperatorRequired:advanced.includes('separately configured sandbox price operator')&&
    matchingJournal.includes('tickSigner:this.tickSigner'),
  m17NoRealPositions:matchingCore.includes('M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN')&&
    matchingCore.includes('executionPermitted: false'),
  m17ConditionalOrdersDoNotSignFunds:advanced.includes('never represent a deployed M5 oracle')&&
    matchingCore.includes('SIGNED_SANDBOX_OPERATOR_NOT_M5_ORACLE')&&
    !matchingCore.includes('broadcastTransaction('),
  m17ReadinessStillBlocked:registry.deployedVerified===0&&
    app.includes('id="tradeButton" class="trade-disabled" disabled'),
  m18HorizonNotSettlement:walletHistory.includes('HORIZON_REPORTED_SUCCESS')&&
    walletHistory.includes('hoxoTrade:false,hoxoDeposit:false')&&
    walletHistory.includes('validateHorizonRoot('),
  m18NoFakeProtocolHistory:sandboxHistory.includes('NO_VERIFIED_SETTLEMENT_OR_COST_BASIS')&&
    sandboxHistory.includes('NO_AUTHENTICATED_FUNDING_EVENTS')&&
    sandboxHistory.includes('NO_VERIFIED_LENDING_CONTRACT_STATE')&&
    sandboxHistory.includes('NO_ONCHAIN_HOXO_TRADE_RECEIPTS'),
  m18SandboxProvenance:sandboxHistory.includes('M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN')&&
    matchingJournal.includes('getPortfolioHistory(owner,options={})'),
  m18ReadOnlyWalletUI:portfolioUI.includes('loadStellarWalletActivity')&&
    portfolioUI.includes('NOT HOXO TRADES')&&
    portfolioServer.includes('/v1/portfolio/wallet')&&
    !portfolioServer.includes('/v1/portfolio/execute'),
  m18NoLiveContracts:registry.deployedVerified===0&&
    registry.statuses.every(x=>x.status==="planned"&&x.contractId===null),
  m19DefaultDisabled:registry.deployedVerified===0&&
    m19Api.includes('DISABLED_NO_VERIFIED_DEPLOYMENTS')&&
    m19Runner.includes('HOXO_M19_OBSERVE_CANDIDATES')&&
    m19Runner.includes('candidates.length===0'),
  m19LedgerHashAnchor:m19Rpc.includes('getLedgers')&&
    m19Rpc.includes('M19 ledger hash divergence')&&
    m19Rpc.includes('Ledger changed during M19 event scan'),
  m19ReplayHaltOnCorruption:m19Store.includes('checkpoint hash-chain')&&
    m19Store.includes('incomplete line')&&
    m19Store.includes('file.sync()'),
  m19NoFabricatedFinancialHistory:m19Store.includes('financialStateDerived:false')&&
    m19Api.includes('hoxoFinancialAccountingAvailable:false')&&
    !m19Runner.includes('sendTransaction'),
  m22AuditNotSelfApproved:m22Gate.includes('BLOCKED_EXTERNAL_AUDIT_AND_LIVE_TESTNET_EVIDENCE_REQUIRED')&&
    m22Gate.includes('mainnetPermitted:false')&&
    m22Gate.includes('publicBetaPermitted:false'),


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
  M16:"M7 read-only multi-product fixed-point risk analytics, stress, exposure caps and liquidation thresholds; snapshots untrusted and authorization disabled",
  M17:"signed sandbox limit/IOC/TP-SL, reduce-only simulated exposure and hash-chained transitions; no deployed oracle, canonical position or real execution",
  M18:"read-only Horizon Testnet payments and signed sandbox portfolio/order history; authentic HOXO positions, PnL, funding, interest and trades unavailable",
  M19:"read-only candidate-only RPC event journal with ledger hash checkpoints, REST/SSE diagnostics and fail-closed reset/replay; NO deployed contracts or real HOXO event reconciliation",
  M20:"process-local pause and HTTP controls; no audited on-chain guardian",
  M21:"read-only signed receipt proof checker; no real Hoxo lifecycle receipts",
  M22:"seeded off-chain fuzz/chaos tests and blocked external-audit release gate; no independent audit or live on-chain chaos",
 },
 invariants
},null,2));
if(Object.values(invariants).some(x=>!x))process.exitCode=1;
