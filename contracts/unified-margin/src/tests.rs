use super::*;
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
#[contract]
struct ApprovedCanonicalRisk;
#[contractimpl]
impl ApprovedCanonicalRisk {
    pub fn authorization_enabled()->bool{true}
    pub fn approve_reservation(
        _env:Env,_owner:Address,_vault:Address,_asset:Address,
        product:u32,amount:i128
    )->bool{(1..=3).contains(&product)&&amount>0&&amount<=60*UNIT}
}
#[contract]
struct UnreadyRisk;
#[contractimpl]
impl UnreadyRisk {
    pub fn authorization_enabled()->bool{false}
    pub fn approve_reservation(
        _env:Env,_owner:Address,_vault:Address,_asset:Address,
        _product:u32,_amount:i128
    )->bool{false}
}
#[contract]
struct DenyingRisk;
#[contractimpl]
impl DenyingRisk {
    pub fn authorization_enabled()->bool{true}
    pub fn approve_reservation(
        _env:Env,_owner:Address,_vault:Address,_asset:Address,
        _product:u32,_amount:i128
    )->bool{false}
}
fn test_id(e:&Env,n:u8)->BytesN<32>{
    BytesN::from_array(e,&[n;32])
}
fn base()->(Env,Address,Address,Address,Address,Address){
    let e=Env::default();
    e.mock_all_auths();
    e.ledger().set_network_id(TESTNET_ID);
    let admin=Address::generate(&e);
    let alice=Address::generate(&e);
    let bob=Address::generate(&e);
    let tok=e.register_stellar_asset_contract_v2(admin.clone()).address();
    let mint=token::StellarAssetClient::new(&e,&tok);
    mint.mint(&alice,&(1000*UNIT));
    mint.mint(&bob,&(1000*UNIT));
    let v=e.register(UnifiedMargin,(&admin,&tok));
    (e,v,admin,alice,bob,tok)
}
fn configure(e:&Env,v:&Address)->(Address,Address,Address){
    let risk=e.register(ApprovedCanonicalRisk,());
    let c=UnifiedMarginClient::new(e,v);
    c.set_risk(&risk);
    let spot=Address::generate(e);
    let perp=Address::generate(e);
    let lending=Address::generate(e);
    c.bind_adapter(&Product::Spot,&spot);
    c.bind_adapter(&Product::Perp,&perp);
    c.bind_adapter(&Product::Lending,&lending);
    c.enable_role(&Product::Spot,&true);
    c.enable_role(&Product::Perp,&true);
    c.enable_role(&Product::Lending,&true);
    c.pause(&false);
    (spot,perp,lending)
}
#[test]
fn m15_starts_paused_without_risk_adapters_or_fake_credit(){
    let (e,v,_,alice,_,asset)=base();
    let c=UnifiedMarginClient::new(&e,&v);
    assert!(c.margin().deposits_paused);
    assert!(!c.margin().risk_approved);
    assert!(!c.margin().risk_configured);
    assert_eq!(c.margin().total_claims_e7,0);
    assert_eq!(c.margin().active_reservations,0);
    assert!(!c.role_enabled(&Product::Spot));
    assert_eq!(c.adapter(&Product::Perp),None);
    assert!(c.try_pause(&false).is_err());
    assert!(c.try_deposit(&alice,&UNIT).is_err());
    assert!(c.try_reserve(&alice,&alice,&Product::Spot,&test_id(&e,1),&UNIT).is_err());
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&v),0);
}
#[test]
fn m15_existing_m7_style_unready_risk_cannot_enable_any_role(){
    let (e,v,_,alice,_,_)=base();
    let c=UnifiedMarginClient::new(&e,&v);
    let unready=e.register(UnreadyRisk,());
    c.set_risk(&unready);
    c.bind_adapter(&Product::Spot,&alice);
    assert!(c.try_enable_role(&Product::Spot,&true).is_err());
    assert!(c.try_pause(&false).is_err());
    assert!(c.margin().deposits_paused);
    assert!(!c.role_enabled(&Product::Spot));
    assert!(!c.margin().risk_approved);
}
#[test]
fn m15_same_deposit_funds_three_distinct_products_without_duplicate_claims(){
    let (e,v,_,alice,_,asset)=base();
    let (spot,perp,lend)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(100*UNIT));
    assert_eq!(c.reserve(&alice,&spot,&Product::Spot,&test_id(&e,1),&(20*UNIT)),80*UNIT);
    assert_eq!(c.reserve(&alice,&perp,&Product::Perp,&test_id(&e,2),&(30*UNIT)),50*UNIT);
    assert_eq!(c.reserve(&alice,&lend,&Product::Lending,&test_id(&e,3),&(25*UNIT)),25*UNIT);
    assert_eq!(c.account(&alice),Account{available_e7:25*UNIT,reserved_e7:75*UNIT});
    assert_eq!(c.totals().user_claims_e7,100*UNIT);
    assert_eq!(c.totals().active_reservations,3);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&v),100*UNIT);
    assert!(c.solvent());
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,4),&(26*UNIT)).is_err());
    assert_eq!(c.totals().active_reservations,3);
}
#[test]
fn m15_owner_cannot_withdraw_locked_margin_or_consume_others_reservations(){
    let (e,v,_,alice,bob,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(30*UNIT));
    c.deposit(&bob,&(10*UNIT));
    c.reserve(&alice,&spot,&Product::Spot,&test_id(&e,5),&(25*UNIT));
    assert!(c.try_withdraw(&alice,&(6*UNIT)).is_err());
    assert!(c.try_reserve(&bob,&spot,&Product::Spot,&test_id(&e,6),&(11*UNIT)).is_err());
    assert_eq!(c.account(&bob).available_e7,10*UNIT);
    assert_eq!(c.withdraw(&alice,&(5*UNIT)),0);
    assert_eq!(c.account(&alice).reserved_e7,25*UNIT);
    assert_eq!(c.totals().user_claims_e7,35*UNIT);
}
#[test]
fn m15_adapter_only_release_recovers_cancelled_order_even_during_pause(){
    let (e,v,_,alice,_,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(50*UNIT));
    let id=test_id(&e,7);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(40*UNIT));
    assert_eq!(c.release(&id,&spot,&(15*UNIT)),25*UNIT);
    assert_eq!(c.account(&alice).available_e7,25*UNIT);
    c.pause(&true);
    assert_eq!(c.release(&id,&spot,&(25*UNIT)),0);
    assert_eq!(c.account(&alice).reserved_e7,0);
    assert_eq!(c.account(&alice).available_e7,50*UNIT);
    assert_eq!(c.totals().active_reservations,0);
    assert!(!c.reservation(&id).unwrap().active);
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,8),&UNIT).is_err());
    assert_eq!(c.withdraw(&alice,&(50*UNIT)),0);
}
#[test]
fn m15_adapter_settlement_transfers_only_reserved_tokens_into_payee_free_account(){
    let (e,v,_,alice,bob,asset)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(100*UNIT));
    let id=test_id(&e,9);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(30*UNIT));
    assert_eq!(c.settle_reserved(&id,&spot,&bob,&(12*UNIT)),18*UNIT);
    assert_eq!(c.account(&alice).available_e7,70*UNIT);
    assert_eq!(c.account(&alice).reserved_e7,18*UNIT);
    assert_eq!(c.account(&bob).available_e7,12*UNIT);
    assert_eq!(c.totals().user_claims_e7,100*UNIT);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&v),100*UNIT);
    assert_eq!(c.settle_reserved(&id,&spot,&bob,&(18*UNIT)),0);
    assert_eq!(c.account(&bob).available_e7,30*UNIT);
    assert_eq!(c.totals().active_reservations,0);
    assert_eq!(c.withdraw(&bob,&(30*UNIT)),0);
    assert_eq!(c.totals().user_claims_e7,70*UNIT);
    assert!(c.solvent());
}
#[test]
fn m15_settling_to_self_never_doubles_account_available_or_reserved(){
    let (e,v,_,alice,_,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(20*UNIT));
    let id=test_id(&e,10);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(12*UNIT));
    assert_eq!(c.settle_reserved(&id,&spot,&alice,&(5*UNIT)),7*UNIT);
    assert_eq!(c.account(&alice).available_e7,13*UNIT);
    assert_eq!(c.account(&alice).reserved_e7,7*UNIT);
    assert_eq!(c.totals().user_claims_e7,20*UNIT);
}
#[test]
fn m15_duplicate_reservation_id_cannot_replay_after_cancellation_or_settlement(){
    let (e,v,_,alice,bob,_)=base();
    let (spot,perp,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(50*UNIT));
    let id=test_id(&e,11);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(10*UNIT));
    assert!(c.try_reserve(&alice,&perp,&Product::Perp,&id,&UNIT).is_err());
    c.release(&id,&spot,&(10*UNIT));
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&id,&UNIT).is_err());
    assert!(c.try_settle_reserved(&id,&spot,&bob,&UNIT).is_err());
    assert!(c.try_release(&id,&spot,&UNIT).is_err());
}
#[test]
fn m15_wrong_adapter_and_excess_settlement_must_fail_without_mutation(){
    let (e,v,_,alice,bob,_)=base();
    let (spot,perp,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(20*UNIT));
    let id=test_id(&e,12);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(12*UNIT));
    assert!(c.try_settle_reserved(&id,&perp,&bob,&UNIT).is_err());
    assert!(c.try_release(&id,&perp,&UNIT).is_err());
    assert!(c.try_settle_reserved(&id,&spot,&bob,&(13*UNIT)).is_err());
    assert!(c.try_release(&id,&spot,&(13*UNIT)).is_err());
    assert!(c.try_release(&id,&spot,&0).is_err());
    assert_eq!(c.account(&alice).reserved_e7,12*UNIT);
    assert_eq!(c.account(&bob).available_e7,0);
    assert_eq!(c.totals().user_claims_e7,20*UNIT);
}
#[test]
fn m15_risk_denies_reservations_and_cannot_credit_margin_without_real_asset(){
    let (e,v,_,alice,_,tok)=base();
    let c=UnifiedMarginClient::new(&e,&v);
    let risk=e.register(DenyingRisk,());
    let adapter=Address::generate(&e);
    c.set_risk(&risk);
    c.bind_adapter(&Product::Lending,&adapter);
    c.enable_role(&Product::Lending,&true);
    c.pause(&false);
    c.deposit(&alice,&(40*UNIT));
    assert!(c.try_reserve(&alice,&adapter,&Product::Lending,&test_id(&e,14),&UNIT).is_err());
    assert!(c.try_deposit(&alice,&(999*UNIT)).is_err());
    assert_eq!(c.account(&alice).reserved_e7,0);
    assert_eq!(c.totals().user_claims_e7,40*UNIT);
    assert_eq!(token::TokenClient::new(&e,&tok).balance(&v),40*UNIT);
}
#[test]
fn m15_role_bindings_once_only_reconfiguration_fails_under_any_pause(){
    let (e,v,_,alice,_,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    let other=Address::generate(&e);
    assert!(c.try_bind_adapter(&Product::Spot,&other).is_err());
    assert!(c.try_set_risk(&other).is_err());
    assert!(c.try_enable_role(&Product::Spot,&false).is_err());
    c.pause(&true);
    assert!(c.try_bind_adapter(&Product::Spot,&other).is_err());
    c.enable_role(&Product::Spot,&false);
    assert!(!c.role_enabled(&Product::Spot));
    assert_eq!(c.adapter(&Product::Spot),Some(spot.clone()));
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,20),&UNIT).is_err());
}
#[test]
fn m15_absent_wallet_or_adapter_signatures_never_mutate_collateral(){
    let (e,v,_,alice,bob,tok)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(30*UNIT));
    let id=test_id(&e,15);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(20*UNIT));
    let before=token::TokenClient::new(&e,&tok).balance(&v);
    e.set_auths(&[]);
    assert!(c.try_deposit(&bob,&UNIT).is_err());
    assert!(c.try_withdraw(&alice,&UNIT).is_err());
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,16),&UNIT).is_err());
    assert!(c.try_settle_reserved(&id,&spot,&bob,&UNIT).is_err());
    assert!(c.try_release(&id,&spot,&UNIT).is_err());
    assert_eq!(c.account(&alice).reserved_e7,20*UNIT);
    assert_eq!(c.totals().user_claims_e7,30*UNIT);
    assert_eq!(token::TokenClient::new(&e,&tok).balance(&v),before);
}
#[test]
fn m15_wrong_network_rejects_all_spending_or_credit_mutations(){
    let (e,v,_,alice,bob,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(25*UNIT));
    let id=test_id(&e,17);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(10*UNIT));
    e.ledger().set_network_id([0;32]);
    assert!(c.try_deposit(&bob,&UNIT).is_err());
    assert!(c.try_withdraw(&alice,&UNIT).is_err());
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,18),&UNIT).is_err());
    assert!(c.try_release(&id,&spot,&UNIT).is_err());
    assert!(c.try_settle_reserved(&id,&spot,&bob,&UNIT).is_err());
    assert_eq!(c.totals().user_claims_e7,25*UNIT);
}
#[test]
fn m15_donated_tokens_are_not_assigned_to_any_wallet_or_role(){
    let (e,v,_,alice,bob,tok)=base();
    let (_spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(25*UNIT));
    token::TokenClient::new(&e,&tok).transfer(&bob,&v,&(6*UNIT));
    assert_eq!(c.totals().user_claims_e7,25*UNIT);
    assert_eq!(c.account(&alice).available_e7,25*UNIT);
    assert_eq!(c.account(&bob).available_e7,0);
    assert!(c.solvent());
    assert_eq!(c.withdraw(&alice,&(25*UNIT)),0);
    assert_eq!(token::TokenClient::new(&e,&tok).balance(&v),6*UNIT);
}
#[test]
fn m15_unsafe_external_token_loss_blocks_withdraw_and_all_new_reservations(){
    let (e,v,_,alice,bob,tok)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(20*UNIT));
    let tok_client=token::TokenClient::new(&e,&tok);
    // Simulates an untrusted collateral token with an external balance drain.
    tok_client.transfer(&v,&bob,&UNIT);
    assert!(!c.solvent());
    assert!(c.try_withdraw(&alice,&UNIT).is_err());
    assert!(c.try_reserve(&alice,&spot,&Product::Spot,&test_id(&e,19),&UNIT).is_err());
    assert_eq!(c.totals().user_claims_e7,20*UNIT);
}
#[test]
fn m15_paused_adapter_can_still_settle_existing_reservation_without_new_liabilities(){
    let (e,v,_,alice,bob,_)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(45*UNIT));
    let id=test_id(&e,21);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(30*UNIT));
    c.pause(&true);
    assert_eq!(c.settle_reserved(&id,&spot,&bob,&(30*UNIT)),0);
    assert_eq!(c.account(&bob).available_e7,30*UNIT);
    assert_eq!(c.account(&alice).available_e7,15*UNIT);
    assert_eq!(c.totals().active_reservations,0);
    assert_eq!(c.withdraw(&bob,&(30*UNIT)),0);
}
#[test]
fn m15_keeper_refreshes_open_reservation_and_account_without_crediting_balance(){
    let (e,v,_,alice,_,tok)=base();
    let (spot,_,_)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    c.deposit(&alice,&(20*UNIT));
    let id=test_id(&e,22);
    c.reserve(&alice,&spot,&Product::Spot,&id,&(10*UNIT));
    let before=c.account(&alice);
    let holdings=token::TokenClient::new(&e,&tok).balance(&v);
    c.keepalive(&alice,&id);
    assert_eq!(c.account(&alice),before);
    assert_eq!(token::TokenClient::new(&e,&tok).balance(&v),holdings);
    assert_eq!(c.reservation(&id).unwrap().remaining_e7,10*UNIT);
}


/// M22: deterministic contract-level stress of 3 distinct product reservations.
 /// This tests the isolated M15 ledger only; M9/M11/M12 adapters are still absent.
#[test]
fn m22_seeded_64_step_reservation_release_and_settlement_conserves_claims(){
    let (e,v,_,alice,bob,asset)=base();
    let (spot,perp,lending)=configure(&e,&v);
    let c=UnifiedMarginClient::new(&e,&v);
    let token=token::TokenClient::new(&e,&asset);
    c.deposit(&alice,&(500*UNIT));
    c.deposit(&bob,&(300*UNIT));
    let mut seed=0x5EED_2026_22u64;
    for i in 0u8..64 {
        seed ^= seed<<13;seed ^= seed>>7;seed ^= seed<<17;
        let amount=i128::from((seed%8)+1)*UNIT;
        let (product,adapter)=match i%3 {
            0=>(Product::Spot,spot.clone()),
            1=>(Product::Perp,perp.clone()),
            _=>(Product::Lending,lending.clone()),
        };
        let id=test_id(&e,i+40);
        let before=c.account(&alice);
        let remaining=c.reserve(&alice,&adapter,&product,&id,&amount);
        assert_eq!(remaining,before.available_e7-amount);
        assert_eq!(c.account(&alice).reserved_e7,amount);
        assert!(c.solvent());
        let credit=amount/2;
        let after_settle=c.settle_reserved(&id,&adapter,&bob,&credit);
        assert_eq!(after_settle,amount-credit);
        if i%7==0 {
            c.pause(&true);
            assert!(c.try_reserve(&alice,&adapter,&product,&test_id(&e,i+150),&UNIT).is_err());
        }
        assert_eq!(c.release(&id,&adapter,&(amount-credit)),0);
        if i%7==0{c.pause(&false);}
        assert_eq!(c.account(&alice).reserved_e7,0);
        assert_eq!(c.account(&bob).reserved_e7,0);
        assert_eq!(c.account(&alice).available_e7+c.account(&bob).available_e7,800*UNIT);
        assert_eq!(c.totals().user_claims_e7,800*UNIT);
        assert_eq!(c.totals().active_reservations,0);
        assert_eq!(token.balance(&v),800*UNIT);
        assert!(c.solvent());
        assert!(!c.reservation(&id).unwrap().active);
        assert!(c.try_reserve(&alice,&adapter,&product,&id,&UNIT).is_err());
    }
    // All claims remain backed, so independent withdrawals can finish.
    let a=c.account(&alice).available_e7;
    let b=c.account(&bob).available_e7;
    assert_eq!(c.withdraw(&alice,&a),0);
    assert_eq!(c.withdraw(&bob,&b),0);
    assert_eq!(c.totals().user_claims_e7,0);
    assert_eq!(token.balance(&v),0);
    assert!(c.solvent());
}
