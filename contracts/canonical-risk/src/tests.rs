use super::*;
use hoxo_unified_margin::{Product,UnifiedMargin,UnifiedMarginClient};
use hoxo_oracle_adapter::{OracleAdapter,OracleAdapterClient};
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
// These are TEST-ONLY contracts. Real deployment must bind audited Hoxo
// portfolio, money-market and clearinghouse contract addresses.
#[contract]
struct TestPortfolio;
#[contractimpl]
impl TestPortfolio {
    pub fn spot_reservation_safe(_e:Env,_owner:Address,amount:i128)->bool{
        amount>0
    }
}
#[contract]
struct TestLending;
#[contractimpl]
impl TestLending {
    pub fn current_outstanding_debt_e7(e:Env)->i128{
        e.storage().instance().get(&1u32).unwrap_or(0)
    }
    pub fn set_debt(e:Env,debt:i128){
        e.storage().instance().set(&1u32,&debt);
    }
}
#[contract]
struct TestPerps;
#[contractimpl]
impl TestPerps {
    pub fn active_positions(e:Env)->u32{
        e.storage().instance().get(&1u32).unwrap_or(0)
    }
    pub fn set_open(e:Env,count:u32){
        e.storage().instance().set(&1u32,&count);
    }
}
fn id(e:&Env,n:u8)->BytesN<32>{BytesN::from_array(e,&[n;32])}
fn setup()->(Env,Address,Address,Address,Address,Address,Address,Address,Address,Address){
    let e=Env::default();e.mock_all_auths();
    e.ledger().set_network_id(TESTNET_ID);
    let admin=Address::generate(&e);
    let alice=Address::generate(&e);
    let bob=Address::generate(&e);
    let a=Address::generate(&e);
    let b=Address::generate(&e);
    let spot=Address::generate(&e);
    let asset=e.register_stellar_asset_contract_v2(admin.clone()).address();
    let mint=token::StellarAssetClient::new(&e,&asset);
    mint.mint(&alice,&(1000*UNIT));
    mint.mint(&bob,&(1000*UNIT));
    let vault=e.register(UnifiedMargin,(&admin,&asset));
    let oracle=e.register(OracleAdapter,(&admin,&1u32,&a,&b));
    (e,admin,alice,bob,a,b,spot,asset,vault,oracle)
}
fn ready(e:&Env,admin:&Address,alice:&Address,a:&Address,b:&Address,spot:&Address,
    asset:&Address,vault:&Address,oracle:&Address)->(Address,Address,Address){
    let risk=e.register(CanonicalRisk,(admin,vault,asset,oracle,&1u32,&(50*UNIT)));
    let o=OracleAdapterClient::new(e,oracle);
    o.pause(&false);
    o.submit(a,&1,&(10*UNIT),&(10*UNIT));
    o.submit(b,&1,&(10*UNIT),&(10*UNIT));
    let g=CanonicalRiskClient::new(e,&risk);
    let m=UnifiedMarginClient::new(e,vault);
    m.set_risk(&risk);
    m.bind_adapter(&Product::Spot,spot);
    let portfolio=e.register(TestPortfolio,());
    let lending=e.register(TestLending,());
    let perps=e.register(TestPerps,());
    g.bind_products(&portfolio,&lending,&perps);
    g.pause(&false);
    m.enable_role(&Product::Spot,&true);
    m.pause(&false);
    m.deposit(alice,&(100*UNIT));
    (risk,lending,perps)
}
#[test]
fn paused_by_default_uses_real_m15_source_and_never_approves_leverage(){
    let (e,admin,alice,_,_,_,spot,asset,vault,oracle)=setup();
    let risk=e.register(CanonicalRisk,(&admin,&vault,&asset,&oracle,&1u32,&(50*UNIT)));
    let g=CanonicalRiskClient::new(&e,&risk);
    assert!(!g.authorization_enabled());
    assert!(g.status().paused);
    assert!(!g.status().cross_product_margin_active);
    assert!(!g.status().borrowing_allowed);
    assert!(!g.status().perps_allowed);
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,1),&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&id(&e,1),&UNIT));
    assert!(!g.approve_borrow(&alice,&spot,&asset,&UNIT,&UNIT));
    assert!(!g.approve_open(&alice,&spot,&1,&UNIT,&UNIT,&UNIT));
    assert_eq!(UnifiedMarginClient::new(&e,&vault).account(&alice).available_e7,0);
}
#[test]
fn two_step_exact_permit_reserves_actual_single_token_m15_collateral(){
    let (e,admin,alice,bob,a,b,spot,asset,vault,oracle)=setup();
    let (risk,_,_)=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let m=UnifiedMarginClient::new(&e,&vault);
    let g=CanonicalRiskClient::new(&e,&risk);
    assert_eq!(m.account(&alice).available_e7,100*UNIT);
    assert!(!g.prepare_spot_reservation(&bob,&id(&e,99),&UNIT));
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,100),&(51*UNIT)));
    assert!(g.prepare_spot_reservation(&alice,&id(&e,1),&(30*UNIT)));
    assert_eq!(g.pending(&alice).unwrap().amount_e7,30*UNIT);
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,2),&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&id(&e,2),&(30*UNIT)));
    assert!(!g.approve_reservation(&alice,&spot,&asset,&1,&id(&e,1),&(30*UNIT)));
    assert!(!g.approve_reservation(&alice,&vault,&spot,&1,&id(&e,1),&(30*UNIT)));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&2,&id(&e,1),&(30*UNIT)));
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,2),&(30*UNIT)).is_err());
    // The failed attempt MUST NOT consume the legitimate owner's permit.
    assert_eq!(g.pending(&alice).unwrap().id,id(&e,1));
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,1),&(30*UNIT)),70*UNIT);
    assert!(g.pending(&alice).is_none());
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,1),&(30*UNIT)).is_err());
    assert_eq!(m.account(&alice).reserved_e7,30*UNIT);
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,2),&(21*UNIT)));
    assert!(g.prepare_spot_reservation(&alice,&id(&e,2),&(20*UNIT)));
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,2),&(20*UNIT)),50*UNIT);
    assert_eq!(m.account(&alice).reserved_e7,50*UNIT);
    assert_eq!(m.totals().user_claims_e7,100*UNIT);
    assert!(m.solvent());
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&vault),100*UNIT);
    // The owner can always withdraw the part never reserved while paused.
    m.pause(&true);
    assert_eq!(m.withdraw(&alice,&(50*UNIT)),0);
    assert_eq!(m.account(&alice).reserved_e7,50*UNIT);
    assert!(m.solvent());
    // This contract is NOT an approval source for lending/perps.
    assert!(!g.approve_borrow(&alice,&spot,&asset,&UNIT,&UNIT));
    assert!(!g.approve_open(&alice,&spot,&1,&UNIT,&UNIT,&UNIT));
}
#[test]
fn stale_or_divergent_oracle_blocks_preflight_and_expiry_prevents_replay(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let (risk,_,_)=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let m=UnifiedMarginClient::new(&e,&vault);
    let g=CanonicalRiskClient::new(&e,&risk);
    e.ledger().with_mut(|l|{l.timestamp+=121;l.sequence_number+=1});
    assert!(g.try_prepare_spot_reservation(&alice,&id(&e,3),&UNIT).is_err());
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,3),&UNIT).is_err());
    let o=OracleAdapterClient::new(&e,&oracle);
    o.submit(&a,&1,&(10*UNIT),&(10*UNIT));
    assert!(g.try_prepare_spot_reservation(&alice,&id(&e,4),&UNIT).is_err());
    o.submit(&b,&1,&(10*UNIT),&(10*UNIT));
    assert!(g.prepare_spot_reservation(&alice,&id(&e,5),&UNIT));
    e.ledger().with_mut(|l|{l.sequence_number+=21;l.timestamp+=10});
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,5),&UNIT).is_err());
    // Expired preflight can be replaced; old ID cannot later be consumed.
    assert!(g.prepare_spot_reservation(&alice,&id(&e,6),&UNIT));
    assert_eq!(g.pending(&alice).unwrap().id,id(&e,6));
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,5),&UNIT).is_err());
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,6),&UNIT),99*UNIT);
    assert!(m.solvent());
}
#[test]
fn pause_cancels_unused_permits_without_blocking_free_withdrawals(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let (risk,_,_)=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let m=UnifiedMarginClient::new(&e,&vault);
    let g=CanonicalRiskClient::new(&e,&risk);
    assert!(g.prepare_spot_reservation(&alice,&id(&e,7),&(30*UNIT)));
    g.pause(&true);
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,7),&(30*UNIT)).is_err());
    assert!(!g.authorization_enabled());
    assert!(g.cancel_spot_reservation(&alice));
    assert!(g.pending(&alice).is_none());
    m.pause(&true);
    assert_eq!(m.withdraw(&alice,&(100*UNIT)),0);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&vault),0);
}
#[test]
fn testnet_network_guard_and_real_owner_signatures_must_not_be_bypassed(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let (risk,_,_)=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let g=CanonicalRiskClient::new(&e,&risk);
    e.set_auths(&[]);
    assert!(g.try_pause(&true).is_err());
    assert!(g.try_prepare_spot_reservation(&alice,&id(&e,8),&UNIT).is_err());
    assert!(g.try_cancel_spot_reservation(&alice).is_err());
    assert!(!g.approve_open(&alice,&spot,&1,&UNIT,&UNIT,&UNIT));
    e.ledger().set_network_id([0;32]);
    assert!(!g.authorization_enabled());
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,8),&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&id(&e,8),&UNIT));
}

#[test]
fn cross_product_bindings_required_before_spot_reservation_can_activate(){
    let (e,admin,alice,_,_,_,_,asset,vault,oracle)=setup();
    let risk=e.register(CanonicalRisk,(&admin,&vault,&asset,&oracle,&1u32,&(50*UNIT)));
    let g=CanonicalRiskClient::new(&e,&risk);
    assert!(!g.status().cross_product_checks_bound);
    assert!(!g.authorization_enabled());
    assert!(g.try_pause(&false).is_err());
    assert!(g.try_prepare_spot_reservation(&alice,&id(&e,11),&UNIT).is_ok());
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,11),&UNIT));
    let portfolio=e.register(TestPortfolio,());
    let lending=e.register(TestLending,());
    let perps=e.register(TestPerps,());
    g.bind_products(&portfolio,&lending,&perps);
    assert!(g.status().cross_product_checks_bound);
    assert!(g.try_bind_products(&portfolio,&lending,&perps).is_err());
    g.pause(&false);
    assert!(g.authorization_enabled());
}
#[test]
fn risk_rechecks_fresh_lending_debt_and_perp_positions_when_m15_consumes_spot_permit(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let (risk,lending,perps)=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let g=CanonicalRiskClient::new(&e,&risk);
    let m=UnifiedMarginClient::new(&e,&vault);
    let l=TestLendingClient::new(&e,&lending);
    let p=TestPerpsClient::new(&e,&perps);
    assert!(g.prepare_spot_reservation(&alice,&id(&e,12),&(10*UNIT)));
    l.set_debt(&(2*UNIT));
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,12),&(10*UNIT)).is_err());
    assert_eq!(m.account(&alice).available_e7,100*UNIT);
    assert!(g.pending(&alice).is_some());
    l.set_debt(&0);
    p.set_open(&1);
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,12),&(10*UNIT)).is_err());
    assert!(g.pending(&alice).is_some());
    p.set_open(&0);
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,12),&(10*UNIT)),90*UNIT);
    assert!(g.pending(&alice).is_none());
    // Fresh cross-product liabilities now deny a new permit before any state change.
    l.set_debt(&(3*UNIT));
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,13),&UNIT));
    l.set_debt(&0);
    p.set_open(&1);
    assert!(!g.prepare_spot_reservation(&alice,&id(&e,13),&UNIT));
    assert_eq!(m.account(&alice).reserved_e7,10*UNIT);
    assert!(m.solvent());
}
