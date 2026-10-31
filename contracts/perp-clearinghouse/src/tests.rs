use super::*;
use soroban_sdk::testutils::{Address as _,Ledger as _};

const UNIT:i128=10_000_000;
#[contract]
struct MockOracle;
#[contractimpl]
impl MockOracle {
    pub fn set(e:Env,mark:i128,index:i128,at:u64){
        e.storage().instance().set(&1u32,&Price {
            mark_e7:mark,index_e7:index,updated_at_sec:at
        });
    }
    pub fn current(e:Env,_market_id:u32)->Price{
        e.storage().instance().get(&1u32).expect("missing price")
    }
}
#[contract]
struct MockAllowRisk;
#[contractimpl]
impl MockAllowRisk {
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,
        _market_id:u32,_signed_base:i128,margin:i128,_mark:i128
    )->bool {margin>0&&margin<=100*UNIT}
}
#[contract]
struct MockDenyRisk;
#[contractimpl]
impl MockDenyRisk {
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,
        _market_id:u32,_signed_base:i128,_margin:i128,_mark:i128
    )->bool {false}
}
fn setup()->(Env,Address,Address,Address,Address,Address) {
    let e=Env::default();
    e.ledger().set_network_id(TESTNET_ID);
    e.mock_all_auths();
    let admin=Address::generate(&e);
    let long=Address::generate(&e);
    let short=Address::generate(&e);
    let asset=e.register_stellar_asset_contract_v2(admin.clone()).address();
    let mint=token::StellarAssetClient::new(&e,&asset);
    mint.mint(&long,&(1000*UNIT));
    mint.mint(&short,&(1000*UNIT));
    let id=e.register(PerpClearinghouse,(&admin,&asset,&1u32));
    (e,id,admin,long,short,asset)
}
fn configure(e:&Env,id:&Address)->Address{
    let oracle=e.register(MockOracle,());
    let risk=e.register(MockAllowRisk,());
    MockOracleClient::new(e,&oracle).set(&(10*UNIT),&(10*UNIT),&e.ledger().timestamp());
    let c=PerpClearinghouseClient::new(e,id);
    c.set_controllers(&oracle,&risk);
    c.set_pause(&false);
    oracle
}
fn id(e:&Env,n:u8)->BytesN<32>{BytesN::from_array(e,&[n;32])}
fn open(e:&Env,market:&Address,long:&Address,short:&Address,n:u8)->Position{
    PerpClearinghouseClient::new(e,market).open(
        &id(e,n),long,short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+20)
    )
}
fn fund(e:&Env,market:&Address,long:&Address,short:&Address){
    let m=PerpClearinghouseClient::new(e,market);
    m.deposit(long,&(100*UNIT));
    m.deposit(short,&(100*UNIT));
}
#[test]
fn m12_starts_paused_without_oracle_risk_or_claimed_margin(){
    let (e,market,_,long,short,_)=setup();
    let c=PerpClearinghouseClient::new(&e,&market);
    let state=c.market();
    assert!(state.paused);
    assert!(!state.oracle_configured);
    assert!(!state.risk_configured);
    assert!(!state.entry_gate_configured);
    assert_eq!(state.total_user_claims_e7,0);
    assert_eq!(state.open_positions,0);
    assert!(c.try_set_pause(&false).is_err());
    assert!(c.try_deposit(&long,&UNIT).is_err());
    assert!(c.try_open(&id(&e,1),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
}
#[test]
fn m12_two_wallets_deposit_and_withdraw_separate_balances(){
    let (e,market,_,long,short,asset)=setup();
    configure(&e,&market);
    let c=PerpClearinghouseClient::new(&e,&market);
    fund(&e,&market,&long,&short);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT);
    assert_eq!(c.market().total_user_claims_e7,200*UNIT);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&market),200*UNIT);
    assert_eq!(c.withdraw(&long,&(25*UNIT)),75*UNIT);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT);
    assert_eq!(c.market().total_user_claims_e7,175*UNIT);
    assert!(c.solvent());
}
#[test]
fn m12_bilateral_open_reserves_proportional_margin_both_sides(){
    let (e,market,_,long,short,asset)=setup();
    configure(&e,&market);
    fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    let p=open(&e,&market,&long,&short,11);
    assert!(p.active);
    assert_eq!(p.entry_price_e7,10*UNIT);
    assert_eq!(p.base_quantity_e7,4*UNIT);
    assert_eq!(p.initial_margin_each_e7,10*UNIT);
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT);
    assert_eq!(c.wallet(&short).locked_e7,10*UNIT);
    assert_eq!(c.wallet(&long).available_e7,90*UNIT);
    assert_eq!(c.market().open_positions,1);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&market),200*UNIT);
    assert!(c.try_withdraw(&long,&(91*UNIT)).is_err());
}
#[test]
fn m12_bilateral_flat_close_unreserves_both_and_prevents_id_reuse(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);
    fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    open(&e,&market,&long,&short,12);
    let p=c.close(&id(&e,12));
    assert!(!p.active);
    assert_eq!(p.long_realised_pnl_e7,0);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT);
    assert_eq!(c.wallet(&long).locked_e7,0);
    assert_eq!(c.wallet(&short).locked_e7,0);
    assert_eq!(c.market().open_positions,0);
    assert!(c.try_close(&id(&e,12)).is_err());
    assert!(c.try_open(&id(&e,12),&long,&short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
}
#[test]
fn m12_profit_and_loss_reconcile_exactly_from_locked_margin_without_minting(){
    let (e,market,_,long,short,asset)=setup();
    let oracle=configure(&e,&market);
    fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    open(&e,&market,&long,&short,13);
    MockOracleClient::new(&e,&oracle).set(&(12*UNIT),&(12*UNIT),&e.ledger().timestamp());
    let p=c.close(&id(&e,13));
    assert_eq!(p.long_realised_pnl_e7,8*UNIT);
    assert_eq!(c.wallet(&long).available_e7,108*UNIT);
    assert_eq!(c.wallet(&short).available_e7,92*UNIT);
    assert_eq!(c.market().total_user_claims_e7,200*UNIT);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&market),200*UNIT);
    c.withdraw(&long,&(108*UNIT));
    c.withdraw(&short,&(92*UNIT));
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&market),0);
    assert!(c.solvent());
}
#[test]
fn m12_short_profit_burns_no_user_margin_and_is_zero_sum(){
    let (e,market,_,long,short,_)=setup();
    let oracle=configure(&e,&market);
    fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,14);
    let c=PerpClearinghouseClient::new(&e,&market);
    MockOracleClient::new(&e,&oracle).set(&(9*UNIT),&(9*UNIT),&e.ledger().timestamp());
    let p=c.close(&id(&e,14));
    assert_eq!(p.long_realised_pnl_e7,-4*UNIT);
    assert_eq!(c.wallet(&long).available_e7,96*UNIT);
    assert_eq!(c.wallet(&short).available_e7,104*UNIT);
    assert_eq!(c.market().total_user_claims_e7,200*UNIT);
}
#[test]
fn m12_wrong_network_rejects_deposit_open_and_close(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);
    fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,15);
    e.ledger().set_network_id([0u8;32]);
    let c=PerpClearinghouseClient::new(&e,&market);
    assert!(c.try_deposit(&long,&UNIT).is_err());
    assert!(c.try_withdraw(&long,&UNIT).is_err());
    assert!(c.try_open(&id(&e,16),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_close(&id(&e,15)).is_err());
    assert!(c.position(&id(&e,15)).unwrap().active);
}
#[test]
fn m12_rejects_stale_future_and_divergent_oracle_before_opening(){
    let (e,market,_,long,short,_)=setup();
    let oracle=configure(&e,&market);
    fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    e.ledger().with_mut(|l|l.timestamp+=125);
    assert!(c.try_open(&id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    let o=MockOracleClient::new(&e,&oracle);
    o.set(&(10*UNIT),&(10*UNIT),&(e.ledger().timestamp()+1));
    assert!(c.try_open(&id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    o.set(&(11*UNIT),&(10*UNIT),&e.ledger().timestamp());
    assert!(c.try_open(&id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert_eq!(c.market().open_positions,0);
}
#[test]
fn m12_execution_limit_and_expiry_violation_halt_position_creation(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    // The default native ledger sequence can be 0; establish a positive
    // sequence before testing a *past* expiration.
    e.ledger().with_mut(|l|l.sequence_number=50);
    assert!(c.try_open(&id(&e,18),&long,&short,&UNIT,&(9*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(11*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+101)).is_err());
    assert!(c.try_open(&id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()-1)).is_err());
}
#[test]
fn m12_position_size_margin_and_distinct_counterparties_required(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    assert!(c.try_open(&id(&e,19),&long,&long,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&id(&e,19),&long,&short,&0,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&id(&e,19),&long,&short,&(1000*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&id(&e,19),&long,&short,&i128::MAX,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert_eq!(c.market().open_positions,0);
}
#[test]
fn m12_administrator_pause_blocks_new_positions_but_allows_safe_close_and_withdraw(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,20);
    let c=PerpClearinghouseClient::new(&e,&market);
    c.set_pause(&true);
    assert!(c.try_deposit(&long,&UNIT).is_err());
    assert!(c.try_open(&id(&e,21),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    c.close(&id(&e,20));
    assert_eq!(c.withdraw(&long,&(100*UNIT)),0);
}
#[test]
fn m12_unauthorised_wallet_cannot_deposit_withdraw_open_or_close(){
    let (e,market,_,long,short,asset)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,22);
    let c=PerpClearinghouseClient::new(&e,&market);
    let before=token::TokenClient::new(&e,&asset).balance(&market);
    e.set_auths(&[]);
    assert!(c.try_deposit(&long,&UNIT).is_err());
    assert!(c.try_withdraw(&long,&UNIT).is_err());
    assert!(c.try_open(&id(&e,23),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_close(&id(&e,22)).is_err());
    assert!(c.position(&id(&e,22)).unwrap().active);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&market),before);
}
#[test]
fn m12_admin_cannot_rebind_or_disable_oracle_check(){
    let (e,market,_,long,_,_)=setup();
    let c=PerpClearinghouseClient::new(&e,&market);
    let oracle=configure(&e,&market);
    let risk=e.register(MockDenyRisk,());
    assert!(c.try_set_controllers(&oracle,&risk).is_err());
    c.set_pause(&true);
    assert!(c.try_set_controllers(&oracle,&risk).is_err());
    e.set_auths(&[]);
    assert!(c.try_set_pause(&false).is_err());
    assert_eq!(c.market().oracle_configured,true);
    assert_eq!(c.market().risk_configured,true);
}
#[test]
fn m12_risk_denial_reverts_margin_reservation(){
    let (e,market,_,long,short,_)=setup();
    let oracle=e.register(MockOracle,());
    let risk=e.register(MockDenyRisk,());
    MockOracleClient::new(&e,&oracle).set(&(10*UNIT),&(10*UNIT),&0);
    let c=PerpClearinghouseClient::new(&e,&market);
    c.set_controllers(&oracle,&risk);c.set_pause(&false);
    fund(&e,&market,&long,&short);
    assert!(c.try_open(&id(&e,24),&long,&short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+20)).is_err());
    assert_eq!(c.wallet(&long).locked_e7,0);
    assert_eq!(c.wallet(&short).locked_e7,0);
    assert_eq!(c.market().open_positions,0);
}
#[test]
fn m12_loss_beyond_margin_reverts_close_and_retains_replay_record(){
    let (e,market,_,long,short,_)=setup();
    let oracle=configure(&e,&market);
    fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,25);
    let c=PerpClearinghouseClient::new(&e,&market);
    MockOracleClient::new(&e,&oracle).set(&(6*UNIT),&(6*UNIT),&0);
    assert!(c.try_close(&id(&e,25)).is_err());
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT);
    assert_eq!(c.wallet(&short).locked_e7,10*UNIT);
    assert!(c.position(&id(&e,25)).unwrap().active);
    assert_eq!(c.market().open_positions,1);
}
#[test]
fn m12_keeper_refreshes_account_and_id_without_mutating_balances(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,26);
    let c=PerpClearinghouseClient::new(&e,&market);
    let before=c.wallet(&long);
    c.keepalive(&long,&short,&id(&e,26));
    assert_eq!(c.wallet(&long),before);
    assert!(c.position(&id(&e,26)).unwrap().active);
}
