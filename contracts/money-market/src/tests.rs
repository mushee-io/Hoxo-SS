use super::*;
use soroban_sdk::testutils::{Address as _,Ledger as _};

const UNIT:i128=10_000_000;
fn setup()->(Env,Address,Address,Address,Address,Address){
    let e=Env::default();
    e.ledger().set_network_id(TESTNET_ID);
    e.mock_all_auths();
    let admin=Address::generate(&e);
    let alice=Address::generate(&e);
    let bob=Address::generate(&e);
    let token_id=e.register_stellar_asset_contract_v2(admin.clone()).address();
    let mint=token::StellarAssetClient::new(&e,&token_id);
    mint.mint(&alice,&(1000*UNIT));
    mint.mint(&bob,&(1000*UNIT));
    let contract=e.register(MoneyMarket,(&admin,&token_id));
    (e,contract,admin,alice,bob,token_id)
}
fn open(e:&Env,contract:&Address){
    MoneyMarketClient::new(e,contract).pause(&false);
}
#[test]
fn initially_paused_supply_only_and_no_fictional_interest(){
    let (e,id,_,alice,_,asset)=setup();
    let market=MoneyMarketClient::new(&e,&id);
    assert!(market.deposits_paused());
    assert!(!market.borrowing_enabled());
    assert!(market.try_borrow_disabled().is_err());
    assert_eq!(market.asset(),asset);
    let view=market.pool();
    assert_eq!(view.cash_e7,0);
    assert_eq!(view.total_shares_e7,0);
    assert_eq!(view.total_borrowed_e7,0);
    assert_eq!(view.protocol_reserves_e7,0);
    assert_eq!(view.supply_index_e7,UNIT);
    assert_eq!(view.borrow_index_e7,UNIT);
    assert_eq!(view.exchange_rate_e7,UNIT);
    assert_eq!(view.rates.utilization_bps,0);
    assert_eq!(view.rates.borrow_apr_bps,200); // hypothetical APR only
    assert_eq!(view.rates.supply_apr_bps,0); // NO borrowers, no interest.
    assert!(market.try_supply(&alice,&(10*UNIT)).is_err());
}
#[test]
fn two_wallets_supply_then_redeem_exact_shares_with_isolated_ownership(){
    let (e,id,_,alice,bob,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    let tok=token::TokenClient::new(&e,&asset);
    assert_eq!(m.supply(&alice,&(200*UNIT)),200*UNIT);
    assert_eq!(m.supply(&bob,&(50*UNIT)),50*UNIT);
    assert_eq!(m.pool().cash_e7,250*UNIT);
    assert_eq!(m.pool().total_shares_e7,250*UNIT);
    assert_eq!(tok.balance(&id),250*UNIT);
    assert_eq!(m.share_balance(&alice),200*UNIT);
    assert_eq!(m.share_balance(&bob),50*UNIT);
    assert_eq!(m.redeem(&alice,&(100*UNIT)),100*UNIT);
    assert_eq!(m.pool().cash_e7,150*UNIT);
    assert_eq!(m.share_balance(&alice),100*UNIT);
    assert_eq!(m.share_balance(&bob),50*UNIT);
    assert_eq!(tok.balance(&alice),900*UNIT);
    assert!(m.solvent());
}
#[test]
fn withdrawal_exact_amount_burns_shares_and_does_not_touch_other_owner(){
    let (e,id,_,alice,bob,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    assert_eq!(m.supply(&alice,&(90*UNIT)),90*UNIT);
    assert_eq!(m.supply(&bob,&(10*UNIT)),10*UNIT);
    assert_eq!(m.withdraw(&alice,&(40*UNIT)),40*UNIT);
    assert_eq!(m.share_balance(&alice),50*UNIT);
    assert_eq!(m.share_balance(&bob),10*UNIT);
    assert_eq!(m.pool().cash_e7,60*UNIT);
    assert_eq!(m.pool().total_shares_e7,60*UNIT);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&id),60*UNIT);
}
#[test]
fn paused_or_reduced_cap_does_not_trap_existing_share_redemptions(){
    let (e,id,_,alice,_,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.supply(&alice,&(80*UNIT));
    m.pause(&true);
    assert!(m.try_supply(&alice,&UNIT).is_err());
    assert_eq!(m.redeem(&alice,&(20*UNIT)),20*UNIT);
    assert_eq!(m.withdraw(&alice,&(60*UNIT)),60*UNIT);
    assert_eq!(m.pool().total_shares_e7,0);
    assert_eq!(m.pool().cash_e7,0);
}
#[test]
fn exact_redemption_of_last_pool_shares_never_leaves_accounted_cash(){
    let (e,id,_,alice,_,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.supply(&alice,&(17*UNIT));
    assert_eq!(m.redeem(&alice,&(17*UNIT)),17*UNIT);
    assert_eq!(m.pool().cash_e7,0);
    assert_eq!(m.pool().total_shares_e7,0);
    assert_eq!(m.share_balance(&alice),0);
    assert_eq!(m.pool().exchange_rate_e7,UNIT);
}
#[test]
fn insufficient_shares_and_overwithdraw_fail_without_state_changes(){
    let (e,id,_,alice,bob,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.supply(&alice,&(30*UNIT));
    assert!(m.try_redeem(&bob,&UNIT).is_err());
    assert!(m.try_withdraw(&bob,&UNIT).is_err());
    assert!(m.try_withdraw(&alice,&(31*UNIT)).is_err());
    assert!(m.try_redeem(&alice,&(31*UNIT)).is_err());
    assert_eq!(m.pool().total_shares_e7,30*UNIT);
    assert_eq!(m.share_balance(&alice),30*UNIT);
}
#[test]
fn zero_negative_overflow_and_invalid_supplies_are_rejected(){
    let (e,id,_,alice,_,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    assert!(m.try_supply(&alice,&0).is_err());
    assert!(m.try_supply(&alice,&(-1)).is_err());
    assert!(m.try_supply(&alice,&i128::MAX).is_err());
    assert!(m.try_redeem(&alice,&0).is_err());
    assert!(m.try_withdraw(&alice,&(-1)).is_err());
    assert_eq!(m.pool().cash_e7,0);
}
#[test]
fn cap_is_respected_and_admin_cannot_reduce_below_current_cash(){
    let (e,id,_,alice,_,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.set_supply_cap(&(20*UNIT));
    assert!(m.try_supply(&alice,&(21*UNIT)).is_err());
    assert_eq!(m.supply(&alice,&(20*UNIT)),20*UNIT);
    assert!(m.try_supply(&alice,&1).is_err());
    assert!(m.try_set_supply_cap(&(19*UNIT)).is_err());
    assert!(m.try_set_supply_cap(&0).is_err());
    assert_eq!(m.pool().cash_e7,20*UNIT);
    assert_eq!(m.pool().supply_cap_e7,20*UNIT);
}
#[test]
fn undercollateralized_transfer_cannot_mint_unbacked_shares(){
    let (e,id,_,alice,_,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    let t=token::TokenClient::new(&e,&asset);
    assert!(m.try_supply(&alice,&(1001*UNIT)).is_err());
    assert_eq!(m.pool().cash_e7,0);
    assert_eq!(m.pool().total_shares_e7,0);
    assert_eq!(t.balance(&id),0);
}
#[test]
fn unrelated_token_donation_is_not_accounted_as_pool_yield_or_mint(){
    let (e,id,_,alice,bob,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    let t=token::TokenClient::new(&e,&asset);
    m.supply(&alice,&(10*UNIT));
    t.transfer(&bob,&id,&(3*UNIT)); // unsolicited direct transfer
    assert_eq!(t.balance(&id),13*UNIT);
    assert_eq!(m.pool().cash_e7,10*UNIT);
    assert_eq!(m.pool().exchange_rate_e7,UNIT);
    m.supply(&bob,&UNIT);
    assert_eq!(m.share_balance(&bob),UNIT);
    assert_eq!(m.redeem(&alice,&(10*UNIT)),10*UNIT);
    assert_eq!(m.redeem(&bob,&UNIT),UNIT);
    assert_eq!(m.pool().total_shares_e7,0);
    assert!(m.solvent()); // no admin sweep of the unsolicited surplus
}
#[test]
fn wrong_network_denies_real supply_and_redemption(){
    let (e,id,_,alice,_,_)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.supply(&alice,&UNIT);
    e.ledger().set_network_id([0;32]);
    assert!(m.try_supply(&alice,&UNIT).is_err());
    assert!(m.try_redeem(&alice,&UNIT).is_err());
    assert_eq!(m.pool().cash_e7,UNIT);
}
#[test]
fn without_authorization_no_account_may_supply_or_redeem(){
    let (e,id,_,alice,_,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    m.supply(&alice,&UNIT);
    let before=token::TokenClient::new(&e,&asset).balance(&id);
    e.set_auths(&[]);
    assert!(m.try_supply(&alice,&UNIT).is_err());
    assert!(m.try_redeem(&alice,&UNIT).is_err());
    assert!(m.try_withdraw(&alice,&UNIT).is_err());
    assert_eq!(m.share_balance(&alice),UNIT);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&id),before);
}
#[test]
fn unauthorized_admin_cannot_unpause_change_cap_or_change_owner(){
    let (e,id,_,alice,_,_)=setup();
    let m=MoneyMarketClient::new(&e,&id);
    e.set_auths(&[]);
    assert!(m.try_pause(&false).is_err());
    assert!(m.try_set_supply_cap(&UNIT).is_err());
    assert!(m.try_transfer_admin(&alice).is_err());
    assert!(m.deposits_paused());
}
#[test]
fn rate_model_is_kinked_and_supply_income_is_zero_at_zero_utilization(){
    let (e,id,_,_,_,_)=setup();
    let m=MoneyMarketClient::new(&e,&id);
    let r0=m.preview_rates(&(1000*UNIT),&0,&1000);
    assert_eq!(r0.utilization_bps,0);
    assert_eq!(r0.borrow_apr_bps,200);
    assert_eq!(r0.supply_apr_bps,0);
    let r50=m.preview_rates(&(1000*UNIT),&(500*UNIT),&1000);
    assert_eq!(r50.utilization_bps,5000);
    assert_eq!(r50.borrow_apr_bps,700);
    assert_eq!(r50.supply_apr_bps,315);
    let r80=m.preview_rates(&(1000*UNIT),&(800*UNIT),&1000);
    assert_eq!(r80.utilization_bps,8000);
    assert_eq!(r80.borrow_apr_bps,1000);
    assert_eq!(r80.supply_apr_bps,720);
    let r100=m.preview_rates(&(1000*UNIT),&(1000*UNIT),&1000);
    assert_eq!(r100.utilization_bps,10000);
    assert_eq!(r100.borrow_apr_bps,8000);
    assert_eq!(r100.supply_apr_bps,7200);
    assert_eq!(m.pool().total_borrowed_e7,0);
}
#[test]
fn invalid_hypothetical_utilization_and_reserve_factor_fail_closed(){
    let (e,id,_,_,_,_)=setup();
    let m=MoneyMarketClient::new(&e,&id);
    assert!(m.try_preview_rates(&UNIT,&(UNIT+1),&1000).is_err());
    assert!(m.try_preview_rates(&(-1),&0,&1000).is_err());
    assert!(m.try_preview_rates(&UNIT,&UNIT,&10001).is_err());
    assert!(m.try_preview_rates(&i128::MAX,&i128::MAX,&1000).is_err());
}
#[test]
fn preview_shares_are_read_only_and_keeper_does_not_mint_or_move_assets(){
    let (e,id,_,alice,_,asset)=setup();
    open(&e,&id);
    let m=MoneyMarketClient::new(&e,&id);
    assert_eq!(m.preview_supply(&(5*UNIT)),5*UNIT);
    m.supply(&alice,&(5*UNIT));
    assert_eq!(m.preview_supply(&(2*UNIT)),2*UNIT);
    let before=token::TokenClient::new(&e,&asset).balance(&id);
    m.keepalive(&alice);
    assert_eq!(token::TokenClient::new(&e,&asset).balance(&id),before);
    assert_eq!(m.share_balance(&alice),5*UNIT);
    assert_eq!(m.pool().protocol_reserves_e7,0);
    assert_eq!(m.pool().borrow_index_e7,UNIT);
    assert_eq!(m.pool().supply_index_e7,UNIT);
}
