use hoxo_risk_math::{
    evaluate, preview_withdrawal, Collateral, Debt, OrderReservation, Perp,
    Policy, Portfolio, RiskError, RiskState, SCALE, MAX_ITEMS,
};
const NOW:u64=1_000_000;
fn c(amount:i128)->Collateral {Collateral{asset:1,amount:amount*SCALE,price_e7:SCALE,price_time_sec:NOW,factor_bps:9000}}
fn d(amount:i128)->Debt {Debt{asset:1,amount_including_interest:amount*SCALE,price_e7:SCALE,price_time_sec:NOW}}
fn perp(size:i128,mark:i128,entry:i128)->Perp {
    Perp{market:1,signed_base_e7:size*SCALE,entry_e7:entry*SCALE,mark_e7:mark*SCALE,mark_time_sec:NOW,initial_margin_bps:1000,maintenance_margin_bps:500}
}
fn p<'a>(collateral:&'a [Collateral], debts:&'a [Debt], perps:&'a [Perp], orders:&'a [OrderReservation], funding:i128)->Portfolio<'a>{
    Portfolio{collateral,debts,perps,orders,pending_funding_e7:funding}
}
fn score(port:&Portfolio<'_>)->hoxo_risk_math::RiskReport {
    evaluate(port,Policy::TEST_POLICY,NOW).unwrap()
}
#[test]
fn empty_is_healthy_with_no_fabricated_margin() {
    let r=score(&p(&[],&[],&[],&[],0));
    assert_eq!(r.state,RiskState::Healthy);
    assert_eq!(r.available_margin_e7,0);
    assert_eq!(r.health_bps,None);
}
#[test]
fn collateral_haircuts_and_borrow_reserves_are_conservative() {
    let r=score(&p(&[c(200)],&[d(100)],&[],&[],0));
    assert_eq!(r.adjusted_collateral_e7,180*SCALE);
    assert_eq!(r.debt_e7,100*SCALE);
    assert_eq!(r.equity_e7,80*SCALE);
    assert_eq!(r.initial_required_e7,20*SCALE);
    assert_eq!(r.maintenance_required_e7,10*SCALE);
    assert_eq!(r.available_margin_e7,60*SCALE);
}
#[test]
fn long_and_short_linear_pnl() {
    let long=score(&p(&[c(100)],&[],&[perp(2,8,10)],&[],0));
    assert_eq!(long.unrealized_pnl_e7,-4*SCALE);
    assert_eq!(long.perp_notional_e7,16*SCALE);
    assert_eq!(long.initial_required_e7,1_600_000);
    assert_eq!(long.maintenance_required_e7,800_000);
    let short=score(&p(&[c(100)],&[],&[perp(-2,12,10)],&[],0));
    assert_eq!(short.unrealized_pnl_e7,-4*SCALE);
}
#[test]
fn order_reservation_reduces_available_margin_even_without_positions() {
    let order=OrderReservation{order:1,initial_e7:25*SCALE,maintenance_e7:10*SCALE};
    let r=score(&p(&[c(50)],&[],&[],&[order],0));
    assert_eq!(r.available_margin_e7,20*SCALE);
    assert_eq!(r.initial_required_e7,25*SCALE);
}
#[test]
fn unaccrued_funding_liability_prevents_fictitious_equity() {
    let r=score(&p(&[c(100)],&[],&[],&[], -50*SCALE));
    assert_eq!(r.equity_e7,40*SCALE);
}
#[test]
fn liquidation_threshold_and_initial_breach_are_distinct() {
    let liquidation=score(&p(&[c(50)],&[d(40)],&[perp(10,5,10)],&[],0));
    assert_eq!(liquidation.state,RiskState::Liquidatable);
    let order=OrderReservation{order:1,initial_e7:15*SCALE,maintenance_e7:2*SCALE};
    let breach=score(&p(&[c(10)],&[],&[],&[order],0));
    assert_eq!(breach.state,RiskState::InitialMarginBreach);
    assert_eq!(breach.health_bps,Some(45000));
}
#[test]
fn withdrawal_preview_is_conservative_and_does_not_mutate_input() {
    let holdings=[c(200)];let loans=[d(100)];
    let port=p(&holdings,&loans,&[],&[],0);
    let ok=preview_withdrawal(&port,Policy::TEST_POLICY,NOW,1,50*SCALE).unwrap();
    assert_eq!(ok.state,RiskState::Healthy);
    let bad=preview_withdrawal(&port,Policy::TEST_POLICY,NOW,1,70*SCALE).unwrap();
    assert_eq!(bad.state,RiskState::InitialMarginBreach);
    assert_eq!(holdings[0].amount,200*SCALE);
    assert_eq!(preview_withdrawal(&port,Policy::TEST_POLICY,NOW,1,201*SCALE),Err(RiskError::InsufficientCollateral));
}
#[test]
fn stale_future_or_missing_price_rejected() {
    let stale=Collateral{price_time_sec:NOW-121,..c(100)};
    assert_eq!(evaluate(&p(&[stale],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::StalePrice));
    let future=Collateral{price_time_sec:NOW+16,..c(100)};
    assert_eq!(evaluate(&p(&[future],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::StalePrice));
    let invalid=Collateral{price_e7:0,..c(100)};
    assert_eq!(evaluate(&p(&[invalid],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::InvalidInput));
}
#[test]
fn duplicate_asset_market_and_order_keys_are_rejected() {
    assert_eq!(evaluate(&p(&[c(10),c(20)],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::DuplicateKey));
    assert_eq!(evaluate(&p(&[],&[d(10),d(20)],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::DuplicateKey));
    assert_eq!(evaluate(&p(&[],&[],&[perp(1,10,10),perp(-1,10,10)],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::DuplicateKey));
    let order=OrderReservation{order:1,initial_e7:10,maintenance_e7:5};
    assert_eq!(evaluate(&p(&[],&[],&[],&[order,order],0),Policy::TEST_POLICY,NOW),Err(RiskError::DuplicateKey));
}
#[test]
fn order_maintenance_cannot_exceed_initial() {
    let order=OrderReservation{order:1,initial_e7:10,maintenance_e7:20};
    assert_eq!(evaluate(&p(&[],&[],&[],&[order],0),Policy::TEST_POLICY,NOW),Err(RiskError::InvalidInput));
}
#[test]
fn invalid_margin_policy_and_negative_sizes_rejected() {
    let bad=Policy{debt_initial_bps:100,debt_maintenance_bps:500,max_age_sec:120};
    assert_eq!(evaluate(&p(&[],&[],&[],&[],0),bad,NOW),Err(RiskError::InvalidInput));
    let bad_asset=Collateral{amount:-1,..c(1)};
    assert_eq!(evaluate(&p(&[bad_asset],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::InvalidInput));
}
#[test]
fn bounds_and_overflow_fail_closed() {
    let too_many=[c(1);MAX_ITEMS+1];
    assert_eq!(evaluate(&p(&too_many,&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::TooManyItems));
    let huge=Collateral{amount:i128::MAX,price_e7:i128::MAX,..c(1)};
    assert_eq!(evaluate(&p(&[huge],&[],&[],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::Overflow));
    let impossible=Perp{signed_base_e7:i128::MIN,..perp(1,1,1)};
    assert_eq!(evaluate(&p(&[],&[],&[impossible],&[],0),Policy::TEST_POLICY,NOW),Err(RiskError::Overflow));
}
#[test]
fn rounds_debt_up_and_negative_pnl_down() {
    let microscopic=Debt{amount_including_interest:1,price_e7:1,..d(1)};
    let small=score(&p(&[],&[microscopic],&[],&[],0));
    assert_eq!(small.debt_e7,1);
    let pnl=Perp{signed_base_e7:1,entry_e7:2,mark_e7:1,..perp(1,1,1)};
    let result=score(&p(&[],&[],&[pnl],&[],0));
    assert_eq!(result.unrealized_pnl_e7,-1);
}
#[test]
fn withdrawal_requires_valid_prestate() {
    let stale=Collateral{price_time_sec:NOW-500,..c(100)};
    assert_eq!(preview_withdrawal(&p(&[stale],&[],&[],&[],0),Policy::TEST_POLICY,NOW,1,SCALE),Err(RiskError::StalePrice));
}
