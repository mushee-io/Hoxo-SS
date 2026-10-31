use super::*;
use hoxo_unified_margin::{UnifiedMargin,UnifiedMarginClient};
use hoxo_money_market::{MoneyMarket,MoneyMarketClient};
use hoxo_perp_clearinghouse::{PerpClearinghouse,PerpClearinghouseClient,Price};
use hoxo_spot_settlement::{SpotSettlement,SpotSettlementClient};
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
#[contract]
struct TestOnlyMarginRisk;
#[contractimpl]
impl TestOnlyMarginRisk{
    pub fn authorization_enabled()->bool{true}
    pub fn approve_reservation(
        _env:Env,_owner:Address,_vault:Address,_asset:Address,
        _product:u32,_id:BytesN<32>,_amount:i128
    )->bool{false}
}
#[contract]
struct TestOnlyPerpDenyRisk;
#[contractimpl]
impl TestOnlyPerpDenyRisk{
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,
        _market_id:u32,_signed_size:i128,_margin:i128,_mark:i128
    )->bool{false}
}
#[contract]
struct TestOnlyBorrowAllowRisk;
#[contractimpl]
impl TestOnlyBorrowAllowRisk{
    pub fn approve_borrow(
        _e:Env,_borrower:Address,_market:Address,_asset:Address,
        amount:i128,projected:i128
    )->bool{amount>0&&projected>0&&projected<=100*UNIT}
}
#[contract]
struct TestOnlyPerpAllowRisk;
#[contractimpl]
impl TestOnlyPerpAllowRisk{
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,
        market:u32,_signed_size:i128,margin:i128,mark:i128
    )->bool{market==1&&margin>0&&margin<=100*UNIT&&mark>0}
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
fn id(e:&Env,v:u8)->BytesN<32>{BytesN::from_array(e,&[v;32])}
struct Fixtures{
    e:Env,admin:Address,buyer:Address,seller:Address,
    asset:Address,base:Address,vault:Address,spot:Address,
    lending:Address,perp:Address,router:Address,
}
impl Fixtures{
    fn new()->Self{Self::with_perp_allow(false)}
    fn with_perp_allow(allow:bool)->Self{
        let e=Env::default();
        e.ledger().set_network_id(TESTNET_ID);
        e.mock_all_auths(); // Local tests are NOT signed Testnet transactions
        let admin=Address::generate(&e);
        let buyer=Address::generate(&e);
        let seller=Address::generate(&e);
        let asset=e.register_stellar_asset_contract_v2(admin.clone()).address();
        let base=e.register_stellar_asset_contract_v2(admin.clone()).address();
        let qmint=token::StellarAssetClient::new(&e,&asset);
        let bmint=token::StellarAssetClient::new(&e,&base);
        for user in [&buyer,&seller]{
            qmint.mint(user,&(1_000*UNIT));
            bmint.mint(user,&(1_000*UNIT));
        }
        let vault=e.register(UnifiedMargin,(&admin,&asset));
        let spot=e.register(SpotSettlement,(&admin,));
        let lending=e.register(MoneyMarket,(&admin,&asset));
        let perp=e.register(PerpClearinghouse,(&admin,&asset,&1u32));
        let router=e.register(CustodyRouter,(
            &admin,&vault,&spot,&lending,&perp,&asset
        ));
        let margin=UnifiedMarginClient::new(&e,&vault);
        let risk=e.register(TestOnlyMarginRisk,());
        margin.set_risk(&risk);
        margin.pause(&false);
        margin.deposit(&buyer,&(200*UNIT));
        margin.deposit(&seller,&(50*UNIT));
        let s=SpotSettlementClient::new(&e,&spot);
        s.set_asset(&asset,&true);s.set_asset(&base,&true);
        s.set_pause(&false);
        let l=MoneyMarketClient::new(&e,&lending);
        l.pause(&false);
        let perp_risk=if allow{
            e.register(TestOnlyPerpAllowRisk,())
        }else{e.register(TestOnlyPerpDenyRisk,())};
        let oracle=e.register(TestOnlyOracle,());
        let p=PerpClearinghouseClient::new(&e,&perp);
        p.set_controllers(&oracle,&perp_risk);
        p.set_pause(&false);
        Self{e,admin,buyer,seller,asset,base,vault,spot,lending,perp,router}
    }
    fn open(&self){CustodyRouterClient::new(&self.e,&self.router).pause(&false);}
    fn m(&self)->UnifiedMarginClient<'_>{UnifiedMarginClient::new(&self.e,&self.vault)}
    fn l(&self)->MoneyMarketClient<'_>{MoneyMarketClient::new(&self.e,&self.lending)}
    fn p(&self)->PerpClearinghouseClient<'_>{PerpClearinghouseClient::new(&self.e,&self.perp)}
    fn r(&self)->CustodyRouterClient<'_>{CustodyRouterClient::new(&self.e,&self.router)}
    fn quote(&self)->token::TokenClient<'_>{token::TokenClient::new(&self.e,&self.asset)}
    fn base(&self)->token::TokenClient<'_>{token::TokenClient::new(&self.e,&self.base)}
    fn terms(&self,n:u8,side:u32)->MatchTerms{
        MatchTerms{
            match_id:id(&self.e,n),maker_order_id:id(&self.e,n+1),
            taker_order_id:id(&self.e,n+2),
            // Both variants: maker sells or buys base, buyer is buyer field
            maker:if side==0{self.seller.clone()}else{self.buyer.clone()},
            taker:if side==0{self.buyer.clone()}else{self.seller.clone()},
            base_token:self.base.clone(),quote_token:self.asset.clone(),
            base_amount:4*UNIT,quote_amount:8*UNIT,
            maker_side:side,
            maker_limit_e7:if side==0{19_000_000}else{21_000_000},
            taker_limit_e7:if side==0{21_000_000}else{19_000_000},
            expires_at_ledger:self.e.ledger().sequence()+20
        }
    }
}
#[test]
fn router_starts_paused_with_no_leverage_or_public_beta(){
    let f=Fixtures::new();
    let status=f.r().status();
    assert!(status.paused);
    assert!(!status.can_borrow_against_m15);
    assert!(!status.can_open_perps_against_m15);
    assert!(!status.financial_beta_approved);
    assert!(f.r().try_supply_from_margin(&f.buyer,&UNIT).is_err());
    assert_eq!(f.m().totals().user_claims_e7,250*UNIT);
}
#[test]
fn m9_real_two_token_dvp_routes_exact_quote_between_m15_balances_both_sides(){
    let f=Fixtures::new();f.open();
    let m=f.m();let r=f.r();
    let total=m.totals().user_claims_e7;
    let vault=f.quote().balance(&f.vault);
    let buyer_quote=f.quote().balance(&f.buyer);
    let seller_quote=f.quote().balance(&f.seller);
    let buyer_base=f.base().balance(&f.buyer);
    let seller_base=f.base().balance(&f.seller);
    for (n,side) in [(8,0u32),(14,1u32)]{
        let terms=f.terms(n,side);
        let receipt=r.settle_spot_from_margin(&terms);
        assert_eq!(receipt.match_id,terms.match_id);
        assert_eq!(receipt.quote_amount,8*UNIT);
        assert_eq!(receipt.base_amount,4*UNIT);
        assert!(SpotSettlementClient::new(&f.e,&f.spot).is_settled(&terms.match_id));
        assert!(r.try_settle_spot_from_margin(&terms).is_err()); // no replay
    }
    assert_eq!(m.account(&f.buyer).available_e7,184*UNIT);
    assert_eq!(m.account(&f.seller).available_e7,66*UNIT);
    assert_eq!(m.totals().user_claims_e7,total);
    assert_eq!(f.quote().balance(&f.vault),vault);
    assert_eq!(f.quote().balance(&f.buyer),buyer_quote);
    assert_eq!(f.quote().balance(&f.seller),seller_quote);
    assert_eq!(f.base().balance(&f.buyer),buyer_base+8*UNIT);
    assert_eq!(f.base().balance(&f.seller),seller_base-8*UNIT);
    assert!(m.solvent());
}
#[test]
fn m9_quote_migration_refuses_locked_funds_low_limit_and_insufficient_balance_without_state_change(){
    let f=Fixtures::new();f.open();
    let r=f.r();let m=f.m();
    let before_claims=m.totals().user_claims_e7;
    let before_v=f.quote().balance(&f.vault);
    let mut terms=f.terms(22,0);
    terms.quote_amount=220*UNIT; // buyer only has 200 free
    assert!(r.try_settle_spot_from_margin(&terms).is_err());
    terms=f.terms(22,0);
    terms.quote_amount=7*UNIT; // violates M9 limit-price constraint
    assert!(r.try_settle_spot_from_margin(&terms).is_err());
    terms=f.terms(22,0);
    terms.quote_token=f.base.clone(); // cannot use M15 vault as unrelated base
    assert!(r.try_settle_spot_from_margin(&terms).is_err());
    assert!(!SpotSettlementClient::new(&f.e,&f.spot).is_settled(&id(&f.e,22)));
    assert_eq!(m.totals().user_claims_e7,before_claims);
    assert_eq!(f.quote().balance(&f.vault),before_v);
    assert_eq!(m.account(&f.buyer).available_e7,200*UNIT);
}
#[test]
fn m11_supply_and_redeem_migrate_real_tokens_without_duplicate_claims_or_fake_yield(){
    let f=Fixtures::new();f.open();
    let m=f.m();let l=f.l();let r=f.r();
    let owner_tokens=f.quote().balance(&f.buyer);
    let before_claims=m.totals().user_claims_e7;
    let to_lending=r.supply_from_margin(&f.buyer,&(40*UNIT));
    assert_eq!(to_lending.tokens_e7,40*UNIT);
    assert_eq!(to_lending.share_units_e7,40*UNIT);
    assert!(to_lending.isolated_not_shared);
    assert_eq!(m.account(&f.buyer).available_e7,160*UNIT);
    assert_eq!(m.totals().user_claims_e7,before_claims-40*UNIT);
    assert_eq!(l.share_balance(&f.buyer),40*UNIT);
    assert_eq!(l.pool().cash_e7,40*UNIT);
    assert_eq!(f.quote().balance(&f.lending),40*UNIT);
    assert_eq!(f.quote().balance(&f.buyer),owner_tokens);
    let back=r.redeem_to_margin(&f.buyer,&(15*UNIT));
    assert_eq!(back.tokens_e7,15*UNIT);
    assert_eq!(m.account(&f.buyer).available_e7,175*UNIT);
    assert_eq!(l.share_balance(&f.buyer),25*UNIT);
    assert_eq!(m.totals().user_claims_e7,before_claims-25*UNIT);
    assert_eq!(f.quote().balance(&f.lending),25*UNIT);
    assert_eq!(f.quote().balance(&f.buyer),owner_tokens);
    assert!(!l.borrowing_enabled());
    assert!(l.solvent());assert!(m.solvent());
}
#[test]
fn m11_paused_supply_or_m15_paused_deposit_reverts_entire_migration(){
    let f=Fixtures::new();f.open();
    let l=f.l();let m=f.m();let r=f.r();
    let before=m.totals().user_claims_e7;
    l.pause(&true);
    assert!(r.try_supply_from_margin(&f.buyer,&(20*UNIT)).is_err());
    assert_eq!(m.totals().user_claims_e7,before);
    assert_eq!(l.pool().cash_e7,0);
    l.pause(&false);
    r.supply_from_margin(&f.buyer,&(20*UNIT));
    m.pause(&true);
    assert!(r.try_redeem_to_margin(&f.buyer,&(20*UNIT)).is_err());
    assert_eq!(l.share_balance(&f.buyer),20*UNIT);
    assert_eq!(f.quote().balance(&f.lending),20*UNIT);
    assert_eq!(m.account(&f.buyer).available_e7,180*UNIT);
    // Independent M11 share redemption is still possible during M15 pause.
    assert_eq!(l.redeem(&f.buyer,&(20*UNIT)),20*UNIT);
    assert_eq!(f.quote().balance(&f.lending),0);
    assert!(m.solvent());
}
#[test]
fn m12_perp_escrow_migrates_exact_real_tokens_without_opening_any_position(){
    let f=Fixtures::new();f.open();
    let m=f.m();let p=f.p();let r=f.r();
    let before_claims=m.totals().user_claims_e7;
    let original_wallet=f.quote().balance(&f.buyer);
    let to_perp=r.perp_from_margin(&f.buyer,&(60*UNIT));
    assert_eq!(to_perp.tokens_e7,60*UNIT);
    assert!(to_perp.isolated_not_shared);
    assert_eq!(m.account(&f.buyer).available_e7,140*UNIT);
    assert_eq!(p.wallet(&f.buyer).available_e7,60*UNIT);
    assert_eq!(p.market().total_user_claims_e7,60*UNIT);
    assert_eq!(m.totals().user_claims_e7,before_claims-60*UNIT);
    assert_eq!(f.quote().balance(&f.perp),60*UNIT);
    assert_eq!(f.quote().balance(&f.buyer),original_wallet);
    assert_eq!(p.active_positions(),0);
    assert!(p.solvent());
    let to_margin=r.perp_to_margin(&f.buyer,&(23*UNIT));
    assert_eq!(to_margin.tokens_e7,23*UNIT);
    assert_eq!(m.account(&f.buyer).available_e7,163*UNIT);
    assert_eq!(p.wallet(&f.buyer).available_e7,37*UNIT);
    assert_eq!(p.market().total_user_claims_e7,37*UNIT);
    assert_eq!(f.quote().balance(&f.perp),37*UNIT);
    assert_eq!(f.quote().balance(&f.buyer),original_wallet);
    assert!(m.solvent());assert!(p.solvent());
}
#[test]
fn m12_paused_contract_and_fake_margin_cannot_take_canonical_funds(){
    let f=Fixtures::new();f.open();
    let p=f.p();let m=f.m();let r=f.r();
    p.set_pause(&true);
    assert!(r.try_perp_from_margin(&f.buyer,&(30*UNIT)).is_err());
    assert_eq!(m.account(&f.buyer).available_e7,200*UNIT);
    assert_eq!(p.wallet(&f.buyer).available_e7,0);
    p.set_pause(&false);
    assert!(r.try_perp_from_margin(&f.seller,&(60*UNIT)).is_err());
    assert_eq!(m.account(&f.seller).available_e7,50*UNIT);
    assert_eq!(f.quote().balance(&f.perp),0);
}
#[test]
fn router_rejects_operator_pause_changes_without_auth_and_wrong_network(){
    let f=Fixtures::new();f.open();
    let r=f.r();
    f.e.set_auths(&[]);
    assert!(r.try_pause(&true).is_err());
    assert!(r.try_supply_from_margin(&f.buyer,&UNIT).is_err());
    assert!(r.try_perp_from_margin(&f.buyer,&UNIT).is_err());
    assert!(r.try_settle_spot_from_margin(&f.terms(31,0)).is_err());
    f.e.ledger().set_network_id([0;32]);
    assert!(r.try_pause(&true).is_err());
    assert!(r.try_supply_from_margin(&f.buyer,&UNIT).is_err());
    assert_eq!(r.status().financial_beta_approved,false);
}

#[test]
fn thirty_two_deterministic_cross_product_round_trips_never_duplicate_claims(){
    let f=Fixtures::new();f.open();
    let r=f.r();let m=f.m();let l=f.l();let p=f.p();
    let original_buyer_quote=f.quote().balance(&f.buyer);
    let original_seller_quote=f.quote().balance(&f.seller);
    let base_buyer=f.base().balance(&f.buyer);
    let mut fills=0i128;
    for i in 0..32u8{
        if i%4==0{
            // Every M9 settlement consumes already-free M15 quote and
            // re-credits seller atomically without touching global claims.
            let receipt=r.settle_spot_from_margin(&f.terms(40+i,0));
            assert_eq!(receipt.base_amount,4*UNIT);
            fills+=1;
        }else if i%4==1{
            let x=r.supply_from_margin(&f.buyer,&(1+((i as i128)%6))*UNIT);
            let y=r.redeem_to_margin(&f.buyer,&x.share_units_e7);
            assert_eq!(y.tokens_e7,x.tokens_e7);
        }else if i%4==2{
            let x=r.perp_from_margin(&f.seller,&(1+((i as i128)%5))*UNIT);
            let y=r.perp_to_margin(&f.seller,&x.tokens_e7);
            assert_eq!(y.tokens_e7,x.tokens_e7);
        }else{
            let x=r.supply_from_margin(&f.seller,&(1+((i as i128)%4))*UNIT);
            let y=r.redeem_to_margin(&f.seller,&x.share_units_e7);
            assert_eq!(y.tokens_e7,x.tokens_e7);
        }
        let sum=m.totals().user_claims_e7
            +l.pool().cash_e7+p.market().total_user_claims_e7;
        assert_eq!(sum,250*UNIT);
        assert_eq!(f.quote().balance(&f.vault)+
            f.quote().balance(&f.lending)+f.quote().balance(&f.perp),sum);
        assert_eq!(f.quote().balance(&f.buyer),original_buyer_quote);
        assert_eq!(f.quote().balance(&f.seller),original_seller_quote);
        assert_eq!(l.outstanding_debt_e7(),0);
        assert_eq!(p.active_positions(),0);
        assert!(m.solvent()&&l.solvent()&&p.solvent());
    }
    assert_eq!(f.base().balance(&f.buyer),base_buyer+fills*4*UNIT);
    assert_eq!(m.totals().user_claims_e7,250*UNIT);
}
#[test]
fn paused_router_never_removes_independent_product_withdrawal_rights(){
    let f=Fixtures::new();f.open();
    let r=f.r();let p=f.p();let m=f.m();
    r.perp_from_margin(&f.buyer,&(20*UNIT));
    r.pause(&true);
    assert!(r.try_perp_to_margin(&f.buyer,&(20*UNIT)).is_err());
    // The original M12 free-balance withdrawal remains callable even when
    // the convenience bridge is paused. This exits to the owner's wallet.
    p.set_pause(&true);
    assert_eq!(p.withdraw(&f.buyer,&(20*UNIT)),0);
    assert_eq!(p.wallet(&f.buyer).available_e7,0);
    assert_eq!(m.account(&f.buyer).available_e7,180*UNIT);
    assert_eq!(f.quote().balance(&f.buyer),820*UNIT);
    assert!(m.solvent()&&p.solvent());
}

#[test]
fn m11_actual_borrowed_debt_blocks_new_custody_routes_until_repaid(){
    let f=Fixtures::new();f.open();
    let r=f.r();let l=f.l();let m=f.m();
    // Test-only permissive borrower, expressly NOT the reviewed M15 risk.
    let risk=f.e.register(TestOnlyBorrowAllowRisk,());
    l.set_risk_authority(&risk);
    l.set_borrow_policy(&(100*UNIT),&9500u32,&1000u32,&true);
    let deposited=r.supply_from_margin(&f.buyer,&(100*UNIT));
    assert_eq!(deposited.tokens_e7,100*UNIT);
    let debt=l.borrow(&f.buyer,&(5*UNIT));
    assert!(debt>=5*UNIT);
    assert!(l.outstanding_debt_e7()>0);
    let before_claims=m.totals().user_claims_e7;
    let before_cash=l.pool().cash_e7;
    assert!(r.try_supply_from_margin(&f.buyer,&UNIT).is_err());
    assert!(r.try_redeem_to_margin(&f.buyer,&UNIT).is_err());
    assert_eq!(m.totals().user_claims_e7,before_claims);
    assert_eq!(l.pool().cash_e7,before_cash);
    assert_eq!(l.repay(&f.buyer,&f.buyer,&(7*UNIT)),5*UNIT);
    assert_eq!(l.outstanding_debt_e7(),0);
    assert_eq!(r.redeem_to_margin(&f.buyer,&(20*UNIT)).tokens_e7,20*UNIT);
    assert!(m.solvent()&&l.solvent());
}
#[test]
fn m12_genuine_local_open_position_blocks_custody_routing_and_locked_exits(){
    let f=Fixtures::with_perp_allow(true);f.open();
    let r=f.r();let p=f.p();let m=f.m();
    m.deposit(&f.seller,&(20*UNIT));
    r.perp_from_margin(&f.buyer,&(40*UNIT));
    r.perp_from_margin(&f.seller,&(40*UNIT));
    let pos=p.open(&id(&f.e,91),&f.buyer,&f.seller,
        &(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(f.e.ledger().sequence()+20));
    assert!(pos.active);
    assert_eq!(p.active_positions(),1);
    assert!(p.wallet(&f.buyer).locked_e7>0);
    let original=m.totals().user_claims_e7;
    assert!(r.try_perp_from_margin(&f.buyer,&UNIT).is_err());
    assert!(r.try_perp_to_margin(&f.buyer,&UNIT).is_err());
    assert_eq!(m.totals().user_claims_e7,original);
    assert_eq!(p.active_positions(),1);
    assert!(p.solvent());
    p.close(&id(&f.e,91));
    assert_eq!(p.active_positions(),0);
    assert_eq!(r.perp_to_margin(&f.buyer,&(10*UNIT)).tokens_e7,10*UNIT);
    assert!(m.solvent()&&p.solvent());
}
