//! M16 pure no-std portfolio analytics — PREVIEW ONLY.
//! Prices, debts and positions are caller supplied; only an independently
//! approved canonical on-chain adapter can turn arithmetic into an authority.
//! No defaults are safe to approve margin or spending.
use super::*;

pub const CAP_MARKET:u32=1;
pub const CAP_TOTAL_NOTIONAL:u32=2;
pub const CAP_DEBT:u32=4;
pub const CAP_ORDERS:u32=8;
pub const CAP_LEVERAGE:u32=16;
pub const CAP_CONCENTRATION:u32=32;
const MAX_STRESS_BPS:u32=8_000;
const MAX_DEBT_RISE_BPS:u32=20_000;
const MAX_LEVERAGE_BPS:u32=100_000;

#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct ExposureCaps {
    pub max_market_notional_e7:i128,
    pub max_total_notional_e7:i128,
    pub max_debt_e7:i128,
    pub max_order_initial_e7:i128,
    pub max_leverage_bps:u32,
    pub max_collateral_concentration_bps:u32,
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct StressScenario {
    pub collateral_price_drop_bps:u32,
    pub debt_price_rise_bps:u32,
    pub perp_adverse_mark_bps:u32,
    pub added_funding_loss_e7:i128,
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct CapResult {
    pub flags:u32,
    pub largest_market_notional_e7:i128,
    pub order_initial_reserved_e7:i128,
    pub leverage_bps:Option<i128>,
    pub concentration_bps:Option<i128>,
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct LiquidationEstimate {
    pub market_id:u32,
    pub current_mark_e7:i128,
    pub first_unsafe_mark_e7:Option<i128>,
    pub already_liquidatable:bool,
    // False means the estimate is not a valid liquidation AUTHORISATION.
    pub execution_permitted:bool,
}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct Analytics {
    pub base:RiskReport,
    pub stressed:RiskReport,
    pub cap:CapResult,
    pub reduce_only_recommended:bool,
    pub execution_permitted:bool,
}
fn stress_valid(s:StressScenario)->Result<(),RiskError>{
    if s.collateral_price_drop_bps>MAX_STRESS_BPS||
       s.perp_adverse_mark_bps>MAX_STRESS_BPS||
       s.debt_price_rise_bps>MAX_DEBT_RISE_BPS||
       s.added_funding_loss_e7<0{
        return Err(RiskError::InvalidInput);
    }
    Ok(())
}
fn cap_valid(c:ExposureCaps)->Result<(),RiskError>{
    if c.max_market_notional_e7<=0||c.max_total_notional_e7<=0||
       c.max_debt_e7<=0||c.max_order_initial_e7<=0||
       c.max_leverage_bps==0||c.max_leverage_bps>MAX_LEVERAGE_BPS||
       c.max_collateral_concentration_bps==0||
       c.max_collateral_concentration_bps>10_000{
        return Err(RiskError::InvalidInput);
    }
    Ok(())
}
fn applied_price(price:i128,numerator:i128,round_up:bool)->Result<i128,RiskError>{
    if price<=0||numerator<=0{return Err(RiskError::InvalidInput);}
    let m=mul(price,numerator)?;
    let p=if round_up{ceil_pos(m,BPS)?}else{m/BPS};
    Ok(p.max(1))
}
pub fn stress(
    portfolio:&Portfolio<'_>,scenario:StressScenario,policy:Policy,now:u64
)->Result<RiskReport,RiskError>{
    stress_valid(scenario)?;
    // Reject invalid/stale original inputs even if stressed values would
    // otherwise look healthy; never refresh stale oracle timestamps.
    evaluate(portfolio,policy,now)?;
    let mut coll=[Collateral::ZERO;MAX_ITEMS];
    let mut debt=[Debt::ZERO;MAX_ITEMS];
    let mut perps=[Perp::ZERO;MAX_ITEMS];
    for (i,c) in portfolio.collateral.iter().enumerate(){
        coll[i]=*c;
        coll[i].price_e7=applied_price(c.price_e7,
            BPS-i128::from(scenario.collateral_price_drop_bps),false)?;
    }
    for (i,d) in portfolio.debts.iter().enumerate(){
        debt[i]=*d;
        debt[i].price_e7=applied_price(d.price_e7,
            BPS+i128::from(scenario.debt_price_rise_bps),true)?;
    }
    for (i,p) in portfolio.perps.iter().enumerate(){
        perps[i]=*p;
        let bps=if p.signed_base_e7>0{
            BPS-i128::from(scenario.perp_adverse_mark_bps)
        }else{
            BPS+i128::from(scenario.perp_adverse_mark_bps)
        };
        perps[i].mark_e7=applied_price(p.mark_e7,bps,p.signed_base_e7<0)?;
    }
    let funding=sub(portfolio.pending_funding_e7,scenario.added_funding_loss_e7)?;
    evaluate(&Portfolio{
        collateral:&coll[..portfolio.collateral.len()],
        debts:&debt[..portfolio.debts.len()],
        perps:&perps[..portfolio.perps.len()],
        orders:portfolio.orders,
        pending_funding_e7:funding,
    },policy,now)
}
pub fn check_caps(
    portfolio:&Portfolio<'_>,report:&RiskReport,caps:ExposureCaps
)->Result<CapResult,RiskError>{
    cap_valid(caps)?;
    let mut flags=0u32;
    let mut largest=0i128;
    for p in portfolio.perps {
        let n=ceil_pos(mul(p.signed_base_e7.checked_abs().ok_or(RiskError::Overflow)?,
            p.mark_e7)?,SCALE)?;
        largest=largest.max(n);
    }
    if largest>caps.max_market_notional_e7{flags|=CAP_MARKET;}
    if report.perp_notional_e7>caps.max_total_notional_e7{flags|=CAP_TOTAL_NOTIONAL;}
    if report.debt_e7>caps.max_debt_e7{flags|=CAP_DEBT;}
    let mut orders=0i128;
    for o in portfolio.orders{
        orders=add(orders,o.initial_e7)?;
    }
    if orders>caps.max_order_initial_e7{flags|=CAP_ORDERS;}
    let leverage=if report.perp_notional_e7==0{Some(0)}
        else if report.equity_e7<=0{None}
        else{Some(ceil_pos(mul(report.perp_notional_e7,BPS)?,report.equity_e7)?)};
    if leverage.map(|v|v>i128::from(caps.max_leverage_bps)).unwrap_or(true){
        flags|=CAP_LEVERAGE;
    }
    let concentration=if report.gross_collateral_e7==0{
        None
    }else{
        let mut largest_value=0i128;
        for c in portfolio.collateral{
            let value=mul(c.amount,c.price_e7)?/SCALE;
            largest_value=largest_value.max(value);
        }
        Some(ceil_pos(mul(largest_value,BPS)?,report.gross_collateral_e7)?)
    };
    if concentration.map(|v|v>i128::from(caps.max_collateral_concentration_bps)).unwrap_or(false){
        flags|=CAP_CONCENTRATION;
    }
    Ok(CapResult{
        flags,largest_market_notional_e7:largest,
        order_initial_reserved_e7:orders,
        leverage_bps:leverage,concentration_bps:concentration,
    })
}
pub fn analyze(
    portfolio:&Portfolio<'_>,policy:Policy,now:u64,
    scenario:StressScenario,caps:ExposureCaps
)->Result<Analytics,RiskError>{
    let base=evaluate(portfolio,policy,now)?;
    let stressed=stress(portfolio,scenario,policy,now)?;
    let cap=check_caps(portfolio,&base,caps)?;
    let reduce_only_recommended=base.state!=RiskState::Healthy||
        stressed.state!=RiskState::Healthy||cap.flags!=0;
    Ok(Analytics{
        base,stressed,cap,reduce_only_recommended,
        execution_permitted:false,
    })
}
/// Finds the first *unsafe* price (in e7 ticks) on the adverse path for one
/// selected market. Other markets, collateral, debt and funding stay fixed.
/// No on-chain oracle history, no liquidity/slippage/funding forecast.
/// With no threshold in bounded search, returns None (not "can't liquidate").
pub fn estimate_liquidation(
    portfolio:&Portfolio<'_>,policy:Policy,now:u64,market:u32
)->Result<LiquidationEstimate,RiskError>{
    let base=evaluate(portfolio,policy,now)?;
    let idx=portfolio.perps.iter().position(|p|p.market==market)
        .ok_or(RiskError::InvalidInput)?;
    let target=portfolio.perps[idx];
    let result=LiquidationEstimate{
        market_id:market,current_mark_e7:target.mark_e7,
        first_unsafe_mark_e7:None,
        already_liquidatable:base.state==RiskState::Liquidatable,
        execution_permitted:false,
    };
    if result.already_liquidatable{
        return Ok(LiquidationEstimate{first_unsafe_mark_e7:Some(target.mark_e7),..result});
    }
    let mut perps=[Perp::ZERO;MAX_ITEMS];
    perps[..portfolio.perps.len()].copy_from_slice(portfolio.perps);
    let unsafe_at=|price:i128,rows:&mut [Perp;MAX_ITEMS]|->Result<bool,RiskError>{
        rows[idx].mark_e7=price;
        let p=Portfolio{
            collateral:portfolio.collateral,debts:portfolio.debts,
            perps:&rows[..portfolio.perps.len()],orders:portfolio.orders,
            pending_funding_e7:portfolio.pending_funding_e7,
        };
        Ok(evaluate(&p,policy,now)?.state==RiskState::Liquidatable)
    };
    if target.signed_base_e7>0{
        // Long: lower marks are worse. Highest unsafe tick below current mark.
        if !unsafe_at(1,&mut perps)?{return Ok(result);}
        let mut low=1i128; // unsafe
        let mut high=target.mark_e7; // safe
        while high-low>1{
            let mid=low+(high-low)/2;
            if unsafe_at(mid,&mut perps)?{low=mid;}else{high=mid;}
        }
        Ok(LiquidationEstimate{first_unsafe_mark_e7:Some(low),..result})
    }else{
        // Short: higher marks are worse. Find first unsafe mark via doubling,
        // with a checked bound; never fake "infinite" prices.
        let mut low=target.mark_e7;
        let mut high=low;
        let mut found=false;
        for _ in 0..24 {
            let next=match high.checked_mul(2){Some(x)=>x,None=>return Err(RiskError::Overflow)};
            high=next;
            if unsafe_at(high,&mut perps)?{found=true;break;}
            low=high;
        }
        if !found{return Ok(result);}
        while high-low>1{
            let mid=low+(high-low)/2;
            if unsafe_at(mid,&mut perps)?{high=mid;}else{low=mid;}
        }
        Ok(LiquidationEstimate{first_unsafe_mark_e7:Some(high),..result})
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    const U:i128=SCALE;
    fn c(asset:u32,amount:i128,price:i128,factor:u32)->Collateral{
        Collateral{asset,amount,price_e7:price,price_time_sec:100,factor_bps:factor}
    }
    fn d(asset:u32,amount:i128,price:i128)->Debt{
        Debt{asset,amount_including_interest:amount,price_e7:price,price_time_sec:100}
    }
    fn p(id:u32,size:i128,entry:i128,mark:i128)->Perp{
        Perp{market:id,signed_base_e7:size,entry_e7:entry,
            mark_e7:mark,mark_time_sec:100,initial_margin_bps:2500,maintenance_margin_bps:1500}
    }
    fn caps()->ExposureCaps{ExposureCaps{
        max_market_notional_e7:500*U,max_total_notional_e7:1000*U,
        max_debt_e7:500*U,max_order_initial_e7:300*U,
        max_leverage_bps:50_000,max_collateral_concentration_bps:10_000
    }}
    fn shock()->StressScenario{StressScenario{
        collateral_price_drop_bps:2000,debt_price_rise_bps:1000,
        perp_adverse_mark_bps:1000,added_funding_loss_e7:0
    }}
    #[test]
    fn diversified_portfolio_combines_spot_collateral_lending_debt_perp_order_reserve(){
        let collateral=[c(1,200*U,U,9000),c(2,100*U,U,8000)];
        let debts=[d(1,40*U,U)];
        let perps=[p(1,10*U,10*U,10*U),p(2,-5*U,10*U,10*U)];
        let orders=[OrderReservation{order:1,initial_e7:20*U,maintenance_e7:10*U}];
        let portfolio=Portfolio{collateral:&collateral,debts:&debts,
            perps:&perps,orders:&orders,pending_funding_e7:-5*U};
        let a=analyze(&portfolio,Policy::TEST_POLICY,100,shock(),caps()).unwrap();
        assert_eq!(a.base.gross_collateral_e7,300*U);
        assert_eq!(a.base.adjusted_collateral_e7,260*U);
        assert_eq!(a.base.debt_e7,40*U);
        assert_eq!(a.base.perp_notional_e7,150*U);
        assert_eq!(a.base.equity_e7,215*U);
        assert_eq!(a.base.initial_required_e7,65*U+5*U/10);
        assert_eq!(a.base.maintenance_required_e7,36*U+5*U/10);
        assert_eq!(a.cap.flags,0);
        assert!(a.stressed.equity_e7<a.base.equity_e7);
        assert!(!a.execution_permitted);
    }
    #[test]
    fn adverse_shocks_are_conservative_for_both_long_and_short(){
        let c1=[c(1,300*U,U,10000)];
        let longs=[p(1,10*U,10*U,10*U)];
        let shorts=[p(1,-10*U,10*U,10*U)];
        let b1=Portfolio{collateral:&c1,debts:&[],perps:&longs,orders:&[],pending_funding_e7:0};
        let b2=Portfolio{collateral:&c1,debts:&[],perps:&shorts,orders:&[],pending_funding_e7:0};
        let s=StressScenario{collateral_price_drop_bps:0,debt_price_rise_bps:0,
            perp_adverse_mark_bps:1000,added_funding_loss_e7:2*U};
        assert_eq!(stress(&b1,s,Policy::TEST_POLICY,100).unwrap().equity_e7,288*U);
        assert_eq!(stress(&b2,s,Policy::TEST_POLICY,100).unwrap().equity_e7,288*U);
    }
    #[test]
    fn all_six_exposure_caps_can_fire_without_approving_spending(){
        let c1=[c(1,200*U,U,10000)];
        let debts=[d(1,100*U,U)];
        let positions=[p(1,10*U,10*U,10*U)];
        let orders=[OrderReservation{order:1,initial_e7:20*U,maintenance_e7:5*U}];
        let portfolio=Portfolio{collateral:&c1,debts:&debts,perps:&positions,orders:&orders,pending_funding_e7:0};
        let strict=ExposureCaps{
            max_market_notional_e7:50*U,max_total_notional_e7:50*U,
            max_debt_e7:50*U,max_order_initial_e7:10*U,
            max_leverage_bps:5_000,max_collateral_concentration_bps:5_000
        };
        let x=analyze(&portfolio,Policy::TEST_POLICY,100,shock(),strict).unwrap();
        assert_eq!(x.cap.flags,63);
        assert!(x.reduce_only_recommended);
        assert!(!x.execution_permitted);
    }
    #[test]
    fn invalid_stale_or_duplicate_portfolio_fails_closed_even_on_zero_shock(){
        let c1=[c(1,100*U,U,9000)];
        let x=Portfolio{collateral:&c1,debts:&[],perps:&[],orders:&[],pending_funding_e7:0};
        assert_eq!(analyze(&x,Policy::TEST_POLICY,300,shock(),caps()),Err(RiskError::StalePrice));
        let dup=[c(1,100*U,U,9000),c(1,10*U,U,9000)];
        let y=Portfolio{collateral:&dup,debts:&[],perps:&[],orders:&[],pending_funding_e7:0};
        assert_eq!(analyze(&y,Policy::TEST_POLICY,100,shock(),caps()),Err(RiskError::DuplicateKey));
    }
    #[test]
    fn zero_liabilities_has_no_infinite_health_or_fabricated_margin_permission(){
        let c1=[c(1,40*U,U,9000)];
        let portfolio=Portfolio{collateral:&c1,debts:&[],perps:&[],orders:&[],pending_funding_e7:0};
        let a=analyze(&portfolio,Policy::TEST_POLICY,100,shock(),caps()).unwrap();
        assert_eq!(a.base.health_bps,None);
        assert_eq!(a.cap.leverage_bps,Some(0));
        assert!(!a.reduce_only_recommended);
        assert!(!a.execution_permitted);
    }
    #[test]
    fn long_liquidation_threshold_is_first_unsafe_tick_not_current_mark(){
        let collateral=[c(1,35*U,U,10000)];
        let positions=[p(1,10*U,10*U,10*U)];
        let x=Portfolio{collateral:&collateral,debts:&[],perps:&positions,orders:&[],pending_funding_e7:0};
        let q=estimate_liquidation(&x,Policy::TEST_POLICY,100,1).unwrap();
        assert!(!q.already_liquidatable);
        let threshold=q.first_unsafe_mark_e7.unwrap();
        assert!(threshold<10*U);
        let mut unsafe_perps=positions;
        unsafe_perps[0].mark_e7=threshold;
        let z=Portfolio{collateral:&collateral,debts:&[],perps:&unsafe_perps,orders:&[],pending_funding_e7:0};
        assert_eq!(evaluate(&z,Policy::TEST_POLICY,100).unwrap().state,RiskState::Liquidatable);
        unsafe_perps[0].mark_e7=threshold+1;
        let zz=Portfolio{collateral:&collateral,debts:&[],perps:&unsafe_perps,orders:&[],pending_funding_e7:0};
        assert_ne!(evaluate(&zz,Policy::TEST_POLICY,100).unwrap().state,RiskState::Liquidatable);
    }
    #[test]
    fn short_liquidation_threshold_is_first_unsafe_tick_not_current_mark(){
        let collateral=[c(1,35*U,U,10000)];
        let positions=[p(1,-10*U,10*U,10*U)];
        let x=Portfolio{collateral:&collateral,debts:&[],perps:&positions,orders:&[],pending_funding_e7:0};
        let q=estimate_liquidation(&x,Policy::TEST_POLICY,100,1).unwrap();
        assert!(!q.already_liquidatable);
        let threshold=q.first_unsafe_mark_e7.unwrap();
        assert!(threshold>10*U);
        let mut prices=positions;
        prices[0].mark_e7=threshold;
        let z=Portfolio{collateral:&collateral,debts:&[],perps:&prices,orders:&[],pending_funding_e7:0};
        assert_eq!(evaluate(&z,Policy::TEST_POLICY,100).unwrap().state,RiskState::Liquidatable);
        prices[0].mark_e7=threshold-1;
        let zz=Portfolio{collateral:&collateral,debts:&[],perps:&prices,orders:&[],pending_funding_e7:0};
        assert_ne!(evaluate(&zz,Policy::TEST_POLICY,100).unwrap().state,RiskState::Liquidatable);
    }
    #[test]
    fn already_liquidatable_return_current_mark_not_false_precision(){
        let collateral=[c(1,5*U,U,10000)];
        let positions=[p(1,10*U,10*U,10*U)];
        let x=Portfolio{collateral:&collateral,debts:&[],perps:&positions,orders:&[],pending_funding_e7:0};
        let q=estimate_liquidation(&x,Policy::TEST_POLICY,100,1).unwrap();
        assert!(q.already_liquidatable);
        assert_eq!(q.first_unsafe_mark_e7,Some(10*U));
        assert!(!q.execution_permitted);
    }
    #[test]
    fn no_market_and_invalid_policy_or_stress_cannot_return_safe_report(){
        let collateral=[c(1,200*U,U,9000)];
        let x=Portfolio{collateral:&collateral,debts:&[],perps:&[],orders:&[],pending_funding_e7:0};
        assert_eq!(estimate_liquidation(&x,Policy::TEST_POLICY,100,7),Err(RiskError::InvalidInput));
        assert_eq!(analyze(&x,Policy::TEST_POLICY,100,
            StressScenario{perp_adverse_mark_bps:9000,..shock()},caps()),Err(RiskError::InvalidInput));
        assert_eq!(analyze(&x,Policy::TEST_POLICY,100,shock(),
            ExposureCaps{max_debt_e7:0,..caps()}),Err(RiskError::InvalidInput));
    }
    #[test]
    fn overflow_in_scenarios_or_limits_never_wraps_to_health(){
        let huge=[c(1,i128::MAX/2,U,10000)];
        let x=Portfolio{collateral:&huge,debts:&[],perps:&[],orders:&[],pending_funding_e7:0};
        assert_eq!(analyze(&x,Policy::TEST_POLICY,100,shock(),caps()),Err(RiskError::Overflow));
    }
    #[test]
    fn worst_case_recommends_reduce_only_but_never_issues_authorization(){
        let collateral=[c(1,40*U,U,9000)];
        let positions=[p(1,10*U,10*U,10*U)];
        let x=Portfolio{collateral:&collateral,debts:&[],perps:&positions,orders:&[],pending_funding_e7:0};
        let severe=StressScenario{collateral_price_drop_bps:5000,
            perp_adverse_mark_bps:5000,debt_price_rise_bps:0,added_funding_loss_e7:0};
        let report=analyze(&x,Policy::TEST_POLICY,100,severe,caps()).unwrap();
        assert_eq!(report.base.state,RiskState::Healthy);
        assert_eq!(report.stressed.state,RiskState::Liquidatable);
        assert!(report.reduce_only_recommended);
        assert!(!report.execution_permitted);
    }
}
