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
    assert!(c.try_open(&self::id(&e,1),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
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
    let p=c.close(&self::id(&e,12));
    assert!(!p.active);
    assert_eq!(p.long_realised_pnl_e7,0);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT);
    assert_eq!(c.wallet(&long).locked_e7,0);
    assert_eq!(c.wallet(&short).locked_e7,0);
    assert_eq!(c.market().open_positions,0);
    assert!(c.try_close(&self::id(&e,12)).is_err());
    assert!(c.try_open(&self::id(&e,12),&long,&short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
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
    let p=c.close(&self::id(&e,13));
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
    let p=c.close(&self::id(&e,14));
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
    assert!(c.try_open(&self::id(&e,16),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_close(&self::id(&e,15)).is_err());
    assert!(c.position(&self::id(&e,15)).unwrap().active);
}
#[test]
fn m12_rejects_stale_future_and_divergent_oracle_before_opening(){
    let (e,market,_,long,short,_)=setup();
    let oracle=configure(&e,&market);
    fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    e.ledger().with_mut(|l|l.timestamp+=125);
    assert!(c.try_open(&self::id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    let o=MockOracleClient::new(&e,&oracle);
    o.set(&(10*UNIT),&(10*UNIT),&(e.ledger().timestamp()+1));
    assert!(c.try_open(&self::id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    o.set(&(11*UNIT),&(10*UNIT),&e.ledger().timestamp());
    assert!(c.try_open(&self::id(&e,17),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
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
    assert!(c.try_open(&self::id(&e,18),&long,&short,&UNIT,&(9*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&self::id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(11*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&self::id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+101)).is_err());
    assert!(c.try_open(&self::id(&e,18),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()-1)).is_err());
}
#[test]
fn m12_position_size_margin_and_distinct_counterparties_required(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    let c=PerpClearinghouseClient::new(&e,&market);
    assert!(c.try_open(&self::id(&e,19),&long,&long,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&self::id(&e,19),&long,&short,&0,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&self::id(&e,19),&long,&short,&(1000*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_open(&self::id(&e,19),&long,&short,&i128::MAX,&(12*UNIT),&(8*UNIT),
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
    assert!(c.try_open(&self::id(&e,21),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    c.close(&self::id(&e,20));
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
    assert!(c.try_open(&self::id(&e,23),&long,&short,&UNIT,&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
    assert!(c.try_close(&self::id(&e,22)).is_err());
    assert!(c.position(&self::id(&e,22)).unwrap().active);
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
    assert!(c.try_open(&self::id(&e,24),&long,&short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
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
    assert!(c.try_close(&self::id(&e,25)).is_err());
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT);
    assert_eq!(c.wallet(&short).locked_e7,10*UNIT);
    assert!(c.position(&self::id(&e,25)).unwrap().active);
    assert_eq!(c.market().open_positions,1);
}
#[test]
fn m12_keeper_refreshes_account_and_id_without_mutating_balances(){
    let (e,market,_,long,short,_)=setup();
    configure(&e,&market);fund(&e,&market,&long,&short);
    open(&e,&market,&long,&short,26);
    let c=PerpClearinghouseClient::new(&e,&market);
    let before=c.wallet(&long);
    c.keepalive(&long,&short,&self::id(&e,26));
    assert_eq!(c.wallet(&long),before);
    assert!(c.position(&self::id(&e,26)).unwrap().active);
}


#[test]
fn m13_starts_with_zero_fee_no_funding_and_reconciled_escrow(){
    let (e,id,_,long,short,asset)=setup();
    let c=PerpClearinghouseClient::new(&e,&id);
    assert_eq!(c.market().fee_bps,0);
    assert_eq!(c.market().accrued_fees_e7,0);
    let z=c.reconciliation();
    assert!(z.solvent);
    assert_eq!(z.actual_cash_e7,0);
    configure(&e,&id);
    fund(&e,&id,&long,&short);
    let r=c.reconciliation();
    assert_eq!(r.actual_cash_e7,200*UNIT);
    assert_eq!(r.user_claims_e7,200*UNIT);
    assert_eq!(r.accrued_fees_e7,0);
    assert_eq!(r.surplus_e7,0);
}
#[test]
fn m13_fees_are_booked_as_protocol_claim_not_user_shares(){
    let (e,id,_,long,short,asset)=setup();
    let c=PerpClearinghouseClient::new(&e,&id);
    c.set_fee_bps(&5);
    configure(&e,&id);
    fund(&e,&id,&long,&short);
    let position=open(&e,&id,&long,&short,50);
    let per_side_fee=200_000i128;
    assert_eq!(position.total_fees_paid_e7,2*per_side_fee);
    assert_eq!(c.market().accrued_fees_e7,2*per_side_fee);
    assert_eq!(c.wallet(&long).available_e7,90*UNIT-per_side_fee);
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT);
    assert_eq!(c.reconciliation().user_claims_e7,200*UNIT-2*per_side_fee);
    let closed=c.close(&self::id(&e,50));
    assert_eq!(closed.total_fees_paid_e7,4*per_side_fee);
    assert_eq!(c.market().accrued_fees_e7,4*per_side_fee);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT-2*per_side_fee);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT-2*per_side_fee);
    let r=c.reconciliation();
    assert!(r.solvent);
    assert_eq!(r.actual_cash_e7,200*UNIT);
    assert_eq!(r.accrued_fees_e7,4*per_side_fee);
    assert_eq!(r.user_claims_e7,200*UNIT-4*per_side_fee);
    c.withdraw(&long,&(100*UNIT-2*per_side_fee));
    c.withdraw(&short,&(100*UNIT-2*per_side_fee));
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&id),4*per_side_fee);
    assert_eq!(c.reconciliation().user_claims_e7,0);
    assert_eq!(c.reconciliation().accrued_fees_e7,4*per_side_fee);
}
#[test]
fn m13_fee_parameter_cannot_change_during_position_or_without_admin(){
    let (e,id,_,long,short,_)=setup();
    let c=PerpClearinghouseClient::new(&e,&id);
    assert!(c.try_set_fee_bps(&11).is_err());
    c.set_fee_bps(&5);
    configure(&e,&id);
    assert!(c.try_set_fee_bps(&0).is_err());
    fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,51);
    c.set_pause(&true);
    assert!(c.try_set_fee_bps(&0).is_err());
    e.set_auths(&[]);
    assert!(c.try_set_fee_bps(&1).is_err());
    assert_eq!(c.market().fee_bps,5);
}
#[test]
fn m13_one_hour_positive_funding_moves_escrow_long_to_short_without_minting(){
    let (e,id,_,long,short,_)=setup();
    let oracle=configure(&e,&id);
    fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,52);
    e.ledger().with_mut(|l|l.timestamp+=3600);
    MockOracleClient::new(&e,&oracle).set(&(101*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    let c=PerpClearinghouseClient::new(&e,&id);
    let transferred=c.settle_funding(&self::id(&e,52));
    assert_eq!(transferred,500_000); // 4 * .1 * 1/8 = .05
    let p=c.position(&self::id(&e,52)).unwrap();
    assert_eq!(p.cumulative_funding_to_short_e7,500_000);
    assert_eq!(p.long_margin_e7,10*UNIT-500_000);
    assert_eq!(p.short_margin_e7,10*UNIT+500_000);
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT-500_000);
    assert_eq!(c.wallet(&short).locked_e7,10*UNIT+500_000);
    assert_eq!(c.reconciliation().user_claims_e7,200*UNIT);
    assert_eq!(c.settle_funding(&self::id(&e,52)),0); // same timestamp
    let settled=c.close(&self::id(&e,52));
    assert_eq!(settled.long_realised_pnl_e7,4*UNIT/10);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT+3_500_000);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT-3_500_000);
    assert_eq!(c.market().open_positions,0);
    assert!(c.solvent());
}
#[test]
fn m13_negative_funding_paid_by_short_can_offset_negative_price_pnl(){
    let (e,id,_,long,short,_)=setup();
    let oracle=configure(&e,&id);
    fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,53);
    e.ledger().with_mut(|l|l.timestamp+=28_800);
    MockOracleClient::new(&e,&oracle).set(&(99*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    let c=PerpClearinghouseClient::new(&e,&id);
    assert_eq!(c.settle_funding(&self::id(&e,53)),-4_000_000);
    let closed=c.close(&self::id(&e,53));
    assert_eq!(closed.long_realised_pnl_e7,-4_000_000);
    assert_eq!(closed.cumulative_funding_to_short_e7,-4_000_000);
    assert_eq!(c.wallet(&long).available_e7,100*UNIT);
    assert_eq!(c.wallet(&short).available_e7,100*UNIT);
}
#[test]
fn m13_stale_funding_over_eight_hours_blocks_close_not_fabricates_catchup(){
    let (e,id,_,long,short,_)=setup();
    let oracle=configure(&e,&id);fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,54);
    e.ledger().with_mut(|l|l.timestamp+=28_801);
    MockOracleClient::new(&e,&oracle).set(&(101*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    let c=PerpClearinghouseClient::new(&e,&id);
    assert!(c.try_settle_funding(&self::id(&e,54)).is_err());
    assert!(c.try_close(&self::id(&e,54)).is_err());
    assert!(c.position(&self::id(&e,54)).unwrap().active);
    assert_eq!(c.wallet(&long).locked_e7,10*UNIT);
}
#[test]
fn m13_oracle_deviation_and_staleness_block_funding(){
    let (e,id,_,long,short,_)=setup();
    let oracle=configure(&e,&id);fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,55);
    e.ledger().with_mut(|l|l.timestamp+=3600);
    let c=PerpClearinghouseClient::new(&e,&id);
    assert!(c.try_settle_funding(&self::id(&e,55)).is_err());
    MockOracleClient::new(&e,&oracle).set(&(103*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    assert!(c.try_settle_funding(&self::id(&e,55)).is_err());
    assert_eq!(c.position(&self::id(&e,55)).unwrap().last_funding_sec,0);
}
#[test]
fn m13_permissionless_funding_cannot_remove_unowned_escrow(){
    let (e,id,_,long,short,asset)=setup();
    let oracle=configure(&e,&id);
    fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,56);
    e.ledger().with_mut(|l|l.timestamp+=3600);
    MockOracleClient::new(&e,&oracle).set(&(101*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    let c=PerpClearinghouseClient::new(&e,&id);
    let before=token::TokenClient::new(&e,&asset).balance(&id);
    e.set_auths(&[]); // no caller wallet auth needed for immutable oracle formula
    assert_eq!(c.settle_funding(&self::id(&e,56)),500_000);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&id),before);
    assert_eq!(c.reconciliation().surplus_e7,0);
    assert!(c.try_close(&self::id(&e,56)).is_err()); // close still needs BOTH
}
#[test]
fn m13_maintenance_breach_prevents_funding_from_draining_escrow(){
    let (e,id,_,long,short,_)=setup();
    let oracle=configure(&e,&id);
    fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,57);
    let c=PerpClearinghouseClient::new(&e,&id);
    for _ in 0..5 {
        e.ledger().with_mut(|l|l.timestamp+=28_800);
        MockOracleClient::new(&e,&oracle).set(&(102*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
        assert_eq!(c.settle_funding(&self::id(&e,57)),800_000*10);
    }
    let before=c.position(&self::id(&e,57)).unwrap();
    e.ledger().with_mut(|l|l.timestamp+=28_800);
    MockOracleClient::new(&e,&oracle).set(&(102*UNIT/10),&(10*UNIT),&e.ledger().timestamp());
    assert!(c.try_settle_funding(&self::id(&e,57)).is_err());
    assert_eq!(c.position(&self::id(&e,57)).unwrap().long_margin_e7,before.long_margin_e7);
}
#[test]
fn m13_unsolicited_token_donation_is_surplus_not_user_equity_or_fees(){
    let (e,id,_,long,short,asset)=setup();
    configure(&e,&id);
    fund(&e,&id,&long,&short);
    let token=token::TokenClient::new(&e,&asset);
    token.transfer(&long,&id,&(3*UNIT));
    let c=PerpClearinghouseClient::new(&e,&id);
    let r=c.reconciliation();
    assert!(r.solvent);
    assert_eq!(r.actual_cash_e7,203*UNIT);
    assert_eq!(r.user_claims_e7,200*UNIT);
    assert_eq!(r.accrued_fees_e7,0);
    assert_eq!(r.surplus_e7,3*UNIT);
    assert!(c.try_withdraw(&short,&(101*UNIT)).is_err());
}
#[test]
fn m13_closed_id_cannot_claim_funding_again_or_reopen(){
    let (e,id,_,long,short,_)=setup();
    configure(&e,&id);fund(&e,&id,&long,&short);
    open(&e,&id,&long,&short,58);
    let c=PerpClearinghouseClient::new(&e,&id);
    c.close(&self::id(&e,58));
    assert!(c.try_settle_funding(&self::id(&e,58)).is_err());
    assert!(c.try_close(&self::id(&e,58)).is_err());
    assert!(c.try_open(&self::id(&e,58),&long,&short,&(4*UNIT),&(12*UNIT),&(8*UNIT),
        &(e.ledger().sequence()+10)).is_err());
}
