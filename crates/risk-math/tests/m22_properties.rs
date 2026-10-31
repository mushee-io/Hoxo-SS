//! M22 deterministic property/stress tests for the *reference* risk model.
 //! No transaction execution, deployed oracle or production solvency guarantee.
use hoxo_risk_math::{
    evaluate, preview_withdrawal, Collateral, Debt, Perp, OrderReservation,
    Policy, Portfolio, RiskError, RiskState, SCALE,
};
const NOW: u64 = 1_000_000;
fn rng(seed: &mut u64) -> u64 {
    // Deterministic xorshift: reproducible input corpus, not cryptographic RNG.
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}
fn rank(s: RiskState) -> u8 {
    match s {RiskState::Liquidatable=>0, RiskState::InitialMarginBreach=>1, RiskState::Healthy=>2}
}
fn score(c:&[Collateral],d:&[Debt],p:&[Perp],o:&[OrderReservation],funding:i128)
 -> hoxo_risk_math::RiskReport {
    evaluate(&Portfolio{collateral:c,debts:d,perps:p,orders:o,pending_funding_e7:funding},
        Policy::TEST_POLICY,NOW).expect("bounded seeded input must be valid")
}
fn collateral(amount:i128)->Collateral {
    Collateral{asset:1,amount,price_e7:SCALE,price_time_sec:NOW,factor_bps:8_500}
}
fn debt(amount:i128)->Debt {
    Debt{asset:1,amount_including_interest:amount,price_e7:SCALE,price_time_sec:NOW}
}
fn perp(qty:i128,entry:i128,mark:i128)->Perp {
    Perp{market:1,signed_base_e7:qty,entry_e7:entry,mark_e7:mark,
        mark_time_sec:NOW,initial_margin_bps:2_500,maintenance_margin_bps:1_500}
}
#[test]
fn m22_seeded_metamorphic_equity_and_margin_monotonicity_2500_cases(){
    let mut seed=0xC0FF_EE42_1979_2026u64;
    for case in 0..2500 {
        let base_coll=(rng(&mut seed)%20_000+1) as i128*SCALE;
        let base_debt=(rng(&mut seed)%10_000+1) as i128*SCALE;
        let qty=(rng(&mut seed)%100+1) as i128*SCALE;
        let mark=(rng(&mut seed)%500+1) as i128*SCALE;
        let entry=(rng(&mut seed)%500+1) as i128*SCALE;
        let funding=-((rng(&mut seed)%100) as i128*SCALE);
        let reserve=(rng(&mut seed)%1000) as i128*SCALE;
        let coll=[collateral(base_coll)];
        let debts=[debt(base_debt)];
        let perps=[perp(qty,entry,mark)];
        let orders=[OrderReservation{order:1,initial_e7:reserve,maintenance_e7:reserve/2}];
        let before=score(&coll,&debts,&perps,&orders,funding);
        assert!(before.initial_required_e7>=before.maintenance_required_e7,"case {case}");
        assert_eq!(before.available_margin_e7,before.equity_e7-before.initial_required_e7);
        let more_coll=[collateral(base_coll+SCALE)];
        let with_coll=score(&more_coll,&debts,&perps,&orders,funding);
        assert!(with_coll.equity_e7>=before.equity_e7,"collateral case {case}");
        assert!(with_coll.available_margin_e7>=before.available_margin_e7);
        assert!(rank(with_coll.state)>=rank(before.state));
        let more_debt=[debt(base_debt+SCALE)];
        let with_debt=score(&coll,&more_debt,&perps,&orders,funding);
        assert!(with_debt.equity_e7<=before.equity_e7,"debt case {case}");
        assert!(with_debt.initial_required_e7>=before.initial_required_e7);
        assert!(with_debt.available_margin_e7<=before.available_margin_e7);
        assert!(rank(with_debt.state)<=rank(before.state));
        let more_orders=[OrderReservation{
            order:1,initial_e7:reserve+SCALE,maintenance_e7:reserve/2+SCALE/2
        }];
        let with_order=score(&coll,&debts,&perps,&more_orders,funding);
        assert_eq!(with_order.equity_e7,before.equity_e7);
        assert!(with_order.available_margin_e7<before.available_margin_e7);
        assert!(rank(with_order.state)<=rank(before.state));
        let with_funding=score(&coll,&debts,&perps,&orders,funding-SCALE);
        assert_eq!(with_funding.equity_e7,before.equity_e7-SCALE);
        assert!(rank(with_funding.state)<=rank(before.state));
        // A withdrawn asset can only worsen or retain available margin, never improve.
        let post=preview_withdrawal(&Portfolio{
            collateral:&coll,debts:&debts,perps:&perps,orders:&orders,
            pending_funding_e7:funding},Policy::TEST_POLICY,NOW,1,SCALE).unwrap();
        assert!(post.equity_e7<=before.equity_e7);
        assert!(post.available_margin_e7<=before.available_margin_e7);
    }
}
#[test]
fn m22_seeded_oracle_stale_future_and_price_overflow_rejected(){
    let mut seed=0xDEAD_BEEF_2026_1022u64;
    for _ in 0..512 {
        let amount=(rng(&mut seed)%1000+1) as i128*SCALE;
        let stale=Collateral{price_time_sec:NOW-121,..collateral(amount)};
        let future=Collateral{price_time_sec:NOW+16,..collateral(amount)};
        let invalid=Collateral{price_e7:0,..collateral(amount)};
        for item in [stale,future]{
            assert_eq!(evaluate(&Portfolio{collateral:&[item],debts:&[],
                perps:&[],orders:&[],pending_funding_e7:0},
                Policy::TEST_POLICY,NOW),Err(RiskError::StalePrice));
        }
        assert_eq!(evaluate(&Portfolio{collateral:&[invalid],debts:&[],
            perps:&[],orders:&[],pending_funding_e7:0},
            Policy::TEST_POLICY,NOW),Err(RiskError::InvalidInput));
    }
    let huge=Collateral{amount:i128::MAX,price_e7:i128::MAX,..collateral(SCALE)};
    assert_eq!(evaluate(&Portfolio{collateral:&[huge],debts:&[],
        perps:&[],orders:&[],pending_funding_e7:0},
        Policy::TEST_POLICY,NOW),Err(RiskError::Overflow));
}
#[test]
fn m22_adverse_perp_marks_never_improve_equity(){
    let mut seed=0x1979_1234_4567_ABCDu64;
    for _ in 0..512 {
        let size=((rng(&mut seed)%100)+1) as i128*SCALE;
        let mark=((rng(&mut seed)%1000)+2) as i128*SCALE;
        let lower=mark-SCALE;
        let higher=mark+SCALE;
        let coll=[collateral(1000*SCALE)];
        let long_old=score(&coll,&[],&[perp(size,mark,mark)],&[],0);
        let long_down=score(&coll,&[],&[perp(size,mark,lower)],&[],0);
        assert!(long_down.equity_e7<long_old.equity_e7);
        let short_old=score(&coll,&[],&[perp(-size,mark,mark)],&[],0);
        let short_up=score(&coll,&[],&[perp(-size,mark,higher)],&[],0);
        assert!(short_up.equity_e7<short_old.equity_e7);
    }
}
