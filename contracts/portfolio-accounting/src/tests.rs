use super::*;
use hoxo_unified_margin::{UnifiedMargin,UnifiedMarginClient};
use hoxo_money_market::{MoneyMarket,MoneyMarketClient};
use hoxo_perp_clearinghouse::{PerpClearinghouse,PerpClearinghouseClient,Price};
use hoxo_custody_router::{CustodyRouter,CustodyRouterClient};
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
#[contract]
struct TestOnlyDenyMarginRisk;
#[contractimpl]
impl TestOnlyDenyMarginRisk{
    pub fn authorization_enabled()->bool{true}
    pub fn approve_reservation(
        _env:Env,_owner:Address,_vault:Address,_asset:Address,
        _role:u32,_id:BytesN<32>,_amount:i128
    )->bool{false}
}
#[contract]
struct TestOnlyAllowBorrowRisk;
#[contractimpl]
impl TestOnlyAllowBorrowRisk{
    pub fn approve_borrow(_e:Env,_borrower:Address,
        _market:Address,_asset:Address,amount:i128,debt:i128
    )->bool{amount>0&&debt<=100*UNIT}
}
#[contract]
struct TestOnlyAllowPerpRisk;
#[contractimpl]
impl TestOnlyAllowPerpRisk{
    pub fn approve_open(_e:Env,_owner:Address,_market:Address,
        _market_id:u32,_signed_base:i128,margin:i128,price:i128
    )->bool{margin>0&&margin<=100*UNIT&&price>0}
}
#[contract]
struct TestOnlyOracle;
#[contractimpl]
impl TestOnlyOracle{
    pub fn current(e:Env,_market_id:u32)->Price{
        Price{mark_e7:10*UNIT,index_e7:10*UNIT,
            updated_at_sec:e.ledger().timestamp()}
    }
}
#[contract]
struct TestOnlySpot;
#[contractimpl]
impl TestOnlySpot{
    pub fn paused()->bool{true}
    pub fn allowed(_e:Env,_asset:Address)->bool{false}
}
struct F{
    e:Env,admin:Address,alice:Address,bob:Address,
    asset:Address,vault:Address,lending:Address,perp:Address,
    router:Address,portfolio:Address,
}
impl F{
    fn new()->Self{
        let e=Env::default();e.ledger().set_network_id(TESTNET_ID);
        e.mock_all_auths(); // local simulator, NOT real Stellar user signatures
        let admin=Address::generate(&e);
        let alice=Address::generate(&e);
        let bob=Address::generate(&e);
        let asset=e.register_stellar_asset_contract_v2(admin.clone()).address();
        let tok=token::StellarAssetClient::new(&e,&asset);
        tok.mint(&alice,&(1000*UNIT));
        tok.mint(&bob,&(1000*UNIT));
        let vault=e.register(UnifiedMargin,(&admin,&asset));
        let lending=e.register(MoneyMarket,(&admin,&asset));
        let perp=e.register(PerpClearinghouse,(&admin,&asset,&1u32));
        let spot=e.register(TestOnlySpot,());
        let router=e.register(CustodyRouter,(&admin,&vault,&spot,&lending,&perp,&asset));
        let portfolio=e.register(PortfolioAccounting,(&admin,&vault,&lending,&perp,&asset));
        let margin=UnifiedMarginClient::new(&e,&vault);
        margin.set_risk(&e.register(TestOnlyDenyMarginRisk,()));
        margin.pause(&false);
        margin.deposit(&alice,&(200*UNIT));
        margin.deposit(&bob,&(50*UNIT));
        MoneyMarketClient::new(&e,&lending).pause(&false);
        let perp_client=PerpClearinghouseClient::new(&e,&perp);
        perp_client.set_controllers(&e.register(TestOnlyOracle,()),
            &e.register(TestOnlyAllowPerpRisk,()));
        perp_client.set_pause(&false);
        CustodyRouterClient::new(&e,&router).pause(&false);
        Self{e,admin,alice,bob,asset,vault,lending,perp,router,portfolio}
    }
    fn p(&self)->PortfolioAccountingClient<'_>{
        PortfolioAccountingClient::new(&self.e,&self.portfolio)
    }
    fn m(&self)->UnifiedMarginClient<'_>{
        UnifiedMarginClient::new(&self.e,&self.vault)
    }
    fn l(&self)->MoneyMarketClient<'_>{
        MoneyMarketClient::new(&self.e,&self.lending)
    }
    fn perps(&self)->PerpClearinghouseClient<'_>{
        PerpClearinghouseClient::new(&self.e,&self.perp)
    }
    fn router(&self)->CustodyRouterClient<'_>{
        CustodyRouterClient::new(&self.e,&self.router)
    }
    fn tok(&self)->token::TokenClient<'_>{
        token::TokenClient::new(&self.e,&self.asset)
    }
}
#[test]
fn initial_empty_product_ledgers_keep_all_liabilities_in_m15_and_never_enable_risk(){
    let f=F::new();
    let a=f.p().snapshot(&f.alice);
    let b=f.p().snapshot(&f.bob);
    assert_eq!(a.m15_available_e7,200*UNIT);
    assert_eq!(a.m15_reserved_e7,0);
    assert_eq!(a.m11_supplier_nominal_e7,0);
    assert_eq!(a.m11_borrower_debt_e7,0);
    assert_eq!(a.m12_locked_e7,0);
    assert_eq!(b.m15_available_e7,50*UNIT);
    assert_eq!(a.nominal_book_assets_e7,250*UNIT);
    assert_eq!(a.nominal_book_liabilities_e7,250*UNIT);
    assert_eq!(a.nominal_book_surplus_e7,0);
    assert_eq!(a.actual_cash_across_vaults_e7,250*UNIT);
    assert_eq!(a.liquid_cash_less_claims_e7,0);
    assert!(a.nominal_book_covered);
    assert!(a.liquidity_only_coverage);
    assert!(a.no_open_credit_or_perp_risk);
    assert!(!a.unified_leverage_authorized);
    assert!(!a.financial_beta_authorized);
    assert!(!f.p().status().independent_audit_approved);
    assert!(!f.p().approve_borrow(&f.alice,&f.lending,&f.asset,&UNIT,&UNIT));
    assert!(!f.p().approve_open(&f.alice,&f.perp,&1,&UNIT,&UNIT,&UNIT));
}
#[test]
fn ownership_and_global_claims_are_conserved_across_actual_m15_m11_m12_handoffs(){
    let f=F::new();
    let r=f.router();
    let m=f.m();
    let before=f.tok().balance(&f.alice);
    r.supply_from_margin(&f.alice,&(40*UNIT));
    r.perp_from_margin(&f.alice,&(30*UNIT));
    r.supply_from_margin(&f.bob,&(20*UNIT));
    let a=f.p().snapshot(&f.alice);
    let b=f.p().snapshot(&f.bob);
    assert_eq!(a.m15_available_e7,130*UNIT);
    assert_eq!(a.m11_supplier_nominal_e7,40*UNIT);
    assert_eq!(a.m12_available_e7,30*UNIT);
    assert_eq!(a.owner_book_before_pnl_e7,200*UNIT);
    assert_eq!(a.owner_net_after_debt_e7,200*UNIT);
    assert_eq!(b.m15_available_e7,30*UNIT);
    assert_eq!(b.m11_supplier_nominal_e7,20*UNIT);
    assert_eq!(a.m15_claims_e7,160*UNIT);
    assert_eq!(a.m11_supplier_liabilities_e7,60*UNIT);
    assert_eq!(a.m12_claims_e7,30*UNIT);
    assert_eq!(a.nominal_book_assets_e7,250*UNIT);
    assert_eq!(a.nominal_book_liabilities_e7,250*UNIT);
    assert_eq!(a.nominal_book_surplus_e7,0);
    assert!(a.nominal_book_covered);
    assert!(a.no_open_credit_or_perp_risk);
    assert_eq!(f.tok().balance(&f.alice),before);
    assert_eq!(m.account(&f.alice).available_e7,130*UNIT);
    assert!(!a.unified_leverage_authorized);
}
#[test]
fn genuine_local_m11_borrowed_debt_is_projected_as_receivable_not_liquid_cash(){
    let f=F::new();
    let lender=f.l();let r=f.router();
    let risk=f.e.register(TestOnlyAllowBorrowRisk,());
    lender.set_risk_authority(&risk);
    lender.set_borrow_policy(&(100*UNIT),&9000u32,&1000u32,&true);
    r.supply_from_margin(&f.alice,&(100*UNIT));
    assert_eq!(lender.borrow(&f.alice,&(10*UNIT)),10*UNIT);
    let a=f.p().snapshot(&f.alice);
    assert_eq!(a.m11_borrower_debt_e7,10*UNIT);
    assert_eq!(a.m11_projected_receivables_e7,10*UNIT);
    assert_eq!(a.m11_supplier_nominal_e7,100*UNIT);
    assert_eq!(a.owner_book_before_pnl_e7,200*UNIT);
    assert_eq!(a.owner_net_after_debt_e7,190*UNIT);
    assert_eq!(a.actual_cash_across_vaults_e7,240*UNIT);
    assert_eq!(a.nominal_book_assets_e7,250*UNIT);
    assert_eq!(a.nominal_book_liabilities_e7,250*UNIT);
    assert_eq!(a.liquid_cash_less_claims_e7,-10*UNIT);
    assert!(!a.no_open_credit_or_perp_risk);
    assert!(!a.liquidity_only_coverage);
    assert!(!a.borrow_credit_loss_risk_priced);
    assert!(!a.unified_leverage_authorized);
    assert!(r.try_redeem_to_margin(&f.alice,&(20*UNIT)).is_err());
    // The projection must include interest to current ledger, rather than
    // the M11 stored borrowed principal at the previous accrual timestamp.
    f.e.ledger().with_mut(|x|{x.timestamp+=86_400;x.sequence_number+=1;});
    let next=f.p().snapshot(&f.alice);
    assert!(next.m11_borrower_debt_e7>10*UNIT);
    assert!(next.m11_projected_receivables_e7>10*UNIT);
    assert!(next.nominal_book_covered);
    assert_eq!(next.nominal_book_surplus_e7,0);
    assert_eq!(next.as_of_sec,f.e.ledger().timestamp());
    assert!(!next.no_open_credit_or_perp_risk);
    assert!(r.try_supply_from_margin(&f.alice,&UNIT).is_err());
}
#[test]
fn stale_31_day_debt_cannot_be_misrepresented_as_current_risk_or_zero_liability(){
    let f=F::new();
    let lender=f.l();let r=f.router();
    lender.set_risk_authority(&f.e.register(TestOnlyAllowBorrowRisk,()));
    lender.set_borrow_policy(&(100*UNIT),&9000u32,&1000u32,&true);
    r.supply_from_margin(&f.alice,&(100*UNIT));
    lender.borrow(&f.alice,&(5*UNIT));
    f.e.ledger().with_mut(|x|{x.timestamp+=31*86400;x.sequence_number+=1;});
    assert!(f.p().try_snapshot(&f.alice).is_err());
    assert!(r.try_supply_from_margin(&f.alice,&UNIT).is_err());
    assert!(r.try_redeem_to_margin(&f.alice,&UNIT).is_err());
}
#[test]
fn actual_open_perp_position_makes_unrealised_account_liabilities_explicitly_incomplete(){
    let f=F::new();let r=f.router();
    r.perp_from_margin(&f.alice,&(40*UNIT));
    r.perp_from_margin(&f.bob,&(40*UNIT));
    let id=BytesN::from_array(&f.e,&[92u8;32]);
    let pos=f.perps().open(&id,&f.alice,&f.bob,
        &(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(f.e.ledger().sequence()+20));
    assert!(pos.active);
    let a=f.p().snapshot(&f.alice);
    assert_eq!(a.m12_global_open_positions,1);
    assert!(a.m12_locked_e7>0);
    assert!(a.nominal_book_covered);
    assert_eq!(a.nominal_book_surplus_e7,0);
    assert!(!a.no_open_credit_or_perp_risk);
    assert!(!a.full_perp_exposure_enumerated);
    assert!(!a.liquidity_only_coverage);
    assert!(!a.unified_leverage_authorized);
    assert!(!f.p().approve_open(&f.alice,&f.perp,&1,&UNIT,&UNIT,&UNIT));
    f.perps().close(&id);
    let closed=f.p().snapshot(&f.alice);
    assert_eq!(closed.m12_global_open_positions,0);
    assert!(closed.full_perp_exposure_enumerated);
    assert!(closed.no_open_credit_or_perp_risk);
}
#[test]
fn token_deficit_is_visible_and_never_becomes_a_positive_solvency_signal(){
    let f=F::new();
    // Test-only mocked authorisations let the fixture simulate a custody
    // exploit. Real wallets cannot transfer a contract's balance arbitrarily.
    f.tok().transfer(&f.vault,&f.admin,&(20*UNIT));
    let p=f.p().snapshot(&f.alice);
    assert!(!p.m15_token_backed);
    assert!(!p.nominal_book_covered);
    assert_eq!(p.nominal_book_surplus_e7,-20*UNIT);
    assert!(!p.liquidity_only_coverage);
    assert!(!p.unified_leverage_authorized);
}
#[test]
fn unauthorised_or_wrong_network_invocation_cannot_enable_any_spending(){
    let f=F::new();let p=f.p();
    f.e.set_auths(&[]);
    let view=p.snapshot(&f.alice);
    assert_eq!(view.m15_available_e7,200*UNIT);
    assert!(!p.status().leveraged_trading_authorized);
    assert!(!p.approve_borrow(&f.alice,&f.lending,&f.asset,&UNIT,&UNIT));
    assert!(!p.approve_open(&f.alice,&f.perp,&1,&UNIT,&UNIT,&UNIT));
    f.e.ledger().set_network_id([0;32]);
    assert!(p.try_snapshot(&f.alice).is_err());
}
