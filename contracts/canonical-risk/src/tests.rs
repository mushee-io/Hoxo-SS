use super::*;
use hoxo_unified_margin::{Product,UnifiedMargin,UnifiedMarginClient};
use hoxo_oracle_adapter::{OracleAdapter,OracleAdapterClient};
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
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
    asset:&Address,vault:&Address,oracle:&Address)->Address{
    let risk=e.register(CanonicalRisk,(admin,vault,asset,oracle,&1u32,&(50*UNIT)));
    let o=OracleAdapterClient::new(e,oracle);
    o.pause(&false);
    o.submit(a,&1,&(10*UNIT),&(10*UNIT));
    o.submit(b,&1,&(10*UNIT),&(10*UNIT));
    let c=CanonicalRiskClient::new(e,&risk);
    let m=UnifiedMarginClient::new(e,vault);
    m.set_risk(&risk);
    m.bind_adapter(&Product::Spot,spot);
    // Enabling risk, M15 role and deposit is a privileged local sandbox action.
    c.pause(&false);
    m.enable_role(&Product::Spot,&true);
    m.pause(&false);
    m.deposit(alice,&(100*UNIT));
    risk
}
#[test]
fn paused_by_default_uses_real_M15_source_and_does_not_approve_leverage(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let c=UnifiedMarginClient::new(&e,&vault);
    let risk=e.register(CanonicalRisk,(&admin,&vault,&asset,&oracle,&1u32,&(50*UNIT)));
    let g=CanonicalRiskClient::new(&e,&risk);
    assert!(!g.authorization_enabled());
    assert!(g.status().paused);
    assert!(!g.status().cross_product_margin_active);
    assert!(!g.status().borrowing_allowed);
    assert!(!g.status().perps_allowed);
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&UNIT));
    assert!(!g.approve_borrow(&alice,&spot,&asset,&UNIT,&UNIT));
    assert!(!g.approve_open(&alice,&spot,&1,&UNIT,&UNIT,&UNIT));
    assert_eq!(c.account(&alice).available_e7,0);
    let _=(a,b);
}
#[test]
fn exact_token_backing_and_single_owner_limit_enforced_by_real_M15_account(){
    let (e,admin,alice,bob,a,b,spot,asset,vault,oracle)=setup();
    let risk=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let m=UnifiedMarginClient::new(&e,&vault);
    let g=CanonicalRiskClient::new(&e,&risk);
    assert_eq!(m.account(&alice).available_e7,100*UNIT);
    assert!(g.approve_reservation(&alice,&vault,&asset,&1,&(30*UNIT)));
    assert!(!g.approve_reservation(&bob,&vault,&asset,&1,&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&2,&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&3,&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&spot,&1,&UNIT));
    assert!(!g.approve_reservation(&alice,&spot,&asset,&1,&UNIT));
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&(51*UNIT)));
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,1),&(30*UNIT)),70*UNIT);
    assert_eq!(m.account(&alice).reserved_e7,30*UNIT);
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&(21*UNIT)));
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,2),&(21*UNIT)).is_err());
    assert_eq!(m.reserve(&alice,&spot,&Product::Spot,&id(&e,2),&(20*UNIT)),50*UNIT);
    assert_eq!(m.account(&alice).reserved_e7,50*UNIT);
    assert_eq!(m.totals().user_claims_e7,100*UNIT);
    assert!(m.solvent());
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&vault),100*UNIT);
    // Pausing never prevents the owner withdrawing its unreserved balance.
    m.pause(&true);
    assert_eq!(m.withdraw(&alice,&(50*UNIT)),0);
    assert_eq!(m.account(&alice).reserved_e7,50*UNIT);
    assert!(m.solvent());
}
#[test]
fn stale_and_outage_oracle_never_approves_new_spot_reservations(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let risk=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let m=UnifiedMarginClient::new(&e,&vault);
    let g=CanonicalRiskClient::new(&e,&risk);
    e.ledger().with_mut(|l|{l.timestamp+=121;l.sequence_number+=1});
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,3),&UNIT).is_err());
    let o=OracleAdapterClient::new(&e,&oracle);
    o.submit(&a,&1,&(10*UNIT),&(10*UNIT));
    // One publisher updated while second is stale; still fail.
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,4),&UNIT).is_err());
    o.submit(&b,&1,&(10*UNIT),&(10*UNIT));
    assert!(g.approve_reservation(&alice,&vault,&asset,&1,&UNIT));
    g.pause(&true);
    assert!(m.try_reserve(&alice,&spot,&Product::Spot,&id(&e,5),&UNIT).is_err());
    assert!(!g.authorization_enabled());
    assert!(!g.approve_borrow(&alice,&spot,&asset,&UNIT,&UNIT));
}
#[test]
fn testnet_network_guard_and_real_owner_signatures_must_not_be_bypassed(){
    let (e,admin,alice,_,a,b,spot,asset,vault,oracle)=setup();
    let risk=ready(&e,&admin,&alice,&a,&b,&spot,&asset,&vault,&oracle);
    let g=CanonicalRiskClient::new(&e,&risk);
    e.set_auths(&[]);
    assert!(g.try_pause(&true).is_err());
    // Canonical risk can never open perps or approve lending even while enabled.
    assert!(!g.approve_open(&alice,&spot,&1,&UNIT,&UNIT,&UNIT));
    e.ledger().set_network_id([0;32]);
    assert!(!g.authorization_enabled());
    assert!(!g.approve_reservation(&alice,&vault,&asset,&1,&UNIT));
}
