#![no_std]
//! HOXO SS M7 + M16 — on-chain PREVIEW analytics, not an execution authority.
//! Inputs are caller-supplied until canonical M5 oracle, M6 vault and
//! clearinghouse modules can provide authenticated state. As a result,
//! authorize_trade and authorize_withdrawal ALWAYS FAIL.
//! Oracle timestamps use the Soroban ledger clock; math uses 7-decimal ints.
use hoxo_risk_math::{
    evaluate, preview_withdrawal, Collateral as MathCollateral,
    Debt as MathDebt, OrderReservation as MathOrder,
    Perp as MathPerp, Policy, Portfolio, RiskError, RiskReport, RiskState, MAX_ITEMS,
};
use hoxo_risk_math::m16::{
    self, ExposureCaps, StressScenario,
};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Env, Vec};

#[contracttype]
#[derive(Clone, Debug)]
pub struct CollateralInput {
    pub asset_id: u32,
    pub amount_e7: i128,
    pub price_e7: i128,
    pub price_time_sec: u64,
    pub collateral_factor_bps: u32,
}
#[contracttype]
#[derive(Clone, Debug)]
pub struct DebtInput {
    pub asset_id: u32,
    pub amount_with_interest_e7: i128,
    pub price_e7: i128,
    pub price_time_sec: u64,
}
#[contracttype]
#[derive(Clone, Debug)]
pub struct PerpInput {
    pub market_id: u32,
    pub signed_size_e7: i128,
    pub entry_price_e7: i128,
    pub mark_price_e7: i128,
    pub mark_time_sec: u64,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
}
#[contracttype]
#[derive(Clone, Debug)]
pub struct OrderInput {
    pub order_id: u32,
    pub initial_reserve_e7: i128,
    pub maintenance_reserve_e7: i128,
}
#[contracttype]
#[derive(Clone, Debug)]
pub struct RiskView {
    pub gross_collateral_e7: i128,
    pub adjusted_collateral_e7: i128,
    pub debt_e7: i128,
    pub notional_e7: i128,
    pub unrealized_pnl_e7: i128,
    pub pending_funding_e7: i128,
    pub initial_margin_e7: i128,
    pub maintenance_margin_e7: i128,
    pub equity_e7: i128,
    pub available_margin_e7: i128,
    pub health_bps: Option<i128>,
    // 0=healthy, 1=initial breach, 2=liquidatable
    pub state: u32,
    // NEVER TRUE until canonical state and approved oracle are enforced.
    pub execution_permitted: bool,
}
// All limits and shocks are caller provided and illustrate conservative
// decision support; no M5/M11/M12 authenticated ledger source is wired.
#[contracttype]
#[derive(Clone,Debug)]
pub struct CapsInput {
    pub max_market_notional_e7:i128,
    pub max_total_notional_e7:i128,
    pub max_debt_e7:i128,
    pub max_order_initial_e7:i128,
    pub max_leverage_bps:u32,
    pub max_concentration_bps:u32,
}
impl CapsInput {
    fn math(self)->ExposureCaps{ExposureCaps{
        max_market_notional_e7:self.max_market_notional_e7,
        max_total_notional_e7:self.max_total_notional_e7,
        max_debt_e7:self.max_debt_e7,
        max_order_initial_e7:self.max_order_initial_e7,
        max_leverage_bps:self.max_leverage_bps,
        max_collateral_concentration_bps:self.max_concentration_bps,
    }}
}
#[contracttype]
#[derive(Clone,Debug)]
pub struct StressInput {
    pub collateral_price_drop_bps:u32,
    pub debt_price_rise_bps:u32,
    pub perp_adverse_mark_bps:u32,
    pub added_funding_loss_e7:i128,
}
impl StressInput {
    fn math(self)->StressScenario{StressScenario{
        collateral_price_drop_bps:self.collateral_price_drop_bps,
        debt_price_rise_bps:self.debt_price_rise_bps,
        perp_adverse_mark_bps:self.perp_adverse_mark_bps,
        added_funding_loss_e7:self.added_funding_loss_e7,
    }}
}
#[contracttype]
#[derive(Clone,Debug)]
pub struct AnalyticsView {
    pub baseline:RiskView,
    pub stressed:RiskView,
    pub cap_flags:u32,
    pub largest_market_notional_e7:i128,
    pub order_reserve_e7:i128,
    pub leverage_bps:Option<i128>,
    pub concentration_bps:Option<i128>,
    pub reduce_only_recommended:bool,
    pub execution_permitted:bool,
}
#[contracttype]
#[derive(Clone,Debug)]
pub struct LiquidationView {
    pub market_id:u32,
    pub current_mark_e7:i128,
    pub first_unsafe_mark_e7:Option<i128>,
    pub already_liquidatable:bool,
    pub execution_permitted:bool,
}
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GateError {
    InvalidInput = 1,
    ArithmeticOverflow = 2,
    StalePrice = 3,
    DuplicateKey = 4,
    TooManyItems = 5,
    InsufficientCollateral = 6,
    NotIntegrated = 7,
}
impl From<RiskError> for GateError {
    fn from(v: RiskError) -> Self {
        match v {
            RiskError::InvalidInput => GateError::InvalidInput,
            RiskError::Overflow => GateError::ArithmeticOverflow,
            RiskError::StalePrice => GateError::StalePrice,
            RiskError::DuplicateKey => GateError::DuplicateKey,
            RiskError::TooManyItems => GateError::TooManyItems,
            RiskError::InsufficientCollateral => GateError::InsufficientCollateral,
        }
    }
}
fn view(report: RiskReport) -> RiskView {
    let state = match report.state {
        RiskState::Healthy => 0,
        RiskState::InitialMarginBreach => 1,
        RiskState::Liquidatable => 2,
    };
    RiskView {
        gross_collateral_e7: report.gross_collateral_e7,
        adjusted_collateral_e7: report.adjusted_collateral_e7,
        debt_e7: report.debt_e7,
        notional_e7: report.perp_notional_e7,
        unrealized_pnl_e7: report.unrealized_pnl_e7,
        pending_funding_e7: report.pending_funding_e7,
        initial_margin_e7: report.initial_required_e7,
        maintenance_margin_e7: report.maintenance_required_e7,
        equity_e7: report.equity_e7,
        available_margin_e7: report.available_margin_e7,
        health_bps: report.health_bps,
        state,
        execution_permitted: false,
    }
}
fn read_inputs(
    coll: Vec<CollateralInput>, debt: Vec<DebtInput>,
    perps: Vec<PerpInput>, orders: Vec<OrderInput>,
) -> Result<(
    [MathCollateral; MAX_ITEMS], usize,
    [MathDebt; MAX_ITEMS], usize,
    [MathPerp; MAX_ITEMS], usize,
    [MathOrder; MAX_ITEMS], usize,
), GateError> {
    if coll.len() as usize > MAX_ITEMS || debt.len() as usize > MAX_ITEMS ||
        perps.len() as usize > MAX_ITEMS || orders.len() as usize > MAX_ITEMS {
        return Err(GateError::TooManyItems);
    }
    let mut coll_rows = [MathCollateral::ZERO; MAX_ITEMS];
    let mut debt_rows = [MathDebt::ZERO; MAX_ITEMS];
    let mut perp_rows = [MathPerp::ZERO; MAX_ITEMS];
    let mut order_rows = [MathOrder::ZERO; MAX_ITEMS];
    let mut c=0usize;
    for x in coll.iter() {
        coll_rows[c] = MathCollateral {
            asset: x.asset_id, amount: x.amount_e7, price_e7: x.price_e7,
            price_time_sec: x.price_time_sec, factor_bps: x.collateral_factor_bps,
        }; c+=1;
    }
    let mut d=0usize;
    for x in debt.iter() {
        debt_rows[d] = MathDebt {
            asset: x.asset_id, amount_including_interest: x.amount_with_interest_e7,
            price_e7: x.price_e7, price_time_sec: x.price_time_sec
        }; d+=1;
    }
    let mut p=0usize;
    for x in perps.iter() {
        perp_rows[p] = MathPerp {
            market: x.market_id, signed_base_e7: x.signed_size_e7,
            entry_e7: x.entry_price_e7, mark_e7: x.mark_price_e7,
            mark_time_sec: x.mark_time_sec,
            initial_margin_bps: x.initial_margin_bps,
            maintenance_margin_bps: x.maintenance_margin_bps,
        }; p+=1;
    }
    let mut o=0usize;
    for x in orders.iter() {
        order_rows[o] = MathOrder {
            order: x.order_id, initial_e7: x.initial_reserve_e7,
            maintenance_e7: x.maintenance_reserve_e7,
        }; o+=1;
    }
    Ok((coll_rows,c,debt_rows,d,perp_rows,p,order_rows,o))
}
#[contract]
pub struct RiskGate;
#[contractimpl]
impl RiskGate {
    pub fn authorization_enabled() -> bool { false }

    pub fn preview(
        env: Env,
        coll: Vec<CollateralInput>,
        debt: Vec<DebtInput>,
        perps: Vec<PerpInput>,
        orders: Vec<OrderInput>,
        pending_funding_e7: i128,
    ) -> Result<RiskView, GateError> {
        let (c,cn,d,dn,p,pn,o,on) = read_inputs(coll,debt,perps,orders)?;
        let portfolio=Portfolio {
            collateral:&c[..cn], debts:&d[..dn],
            perps:&p[..pn], orders:&o[..on], pending_funding_e7,
        };
        evaluate(&portfolio,Policy::TEST_POLICY,env.ledger().timestamp())
            .map(view).map_err(Into::into)
    }
    pub fn preview_withdraw(
        env: Env,
        coll: Vec<CollateralInput>,
        debt: Vec<DebtInput>,
        perps: Vec<PerpInput>,
        orders: Vec<OrderInput>,
        pending_funding_e7: i128,
        asset_id: u32,
        withdraw_e7: i128,
    ) -> Result<RiskView, GateError> {
        let (c,cn,d,dn,p,pn,o,on) = read_inputs(coll,debt,perps,orders)?;
        let portfolio=Portfolio {
            collateral:&c[..cn], debts:&d[..dn], perps:&p[..pn],
            orders:&o[..on], pending_funding_e7,
        };
        preview_withdrawal(&portfolio,Policy::TEST_POLICY,
            env.ledger().timestamp(),asset_id,withdraw_e7)
            .map(view).map_err(Into::into)
    }
    /// M16 portfolio health, scenario stress and exposure caps. READ ONLY.
    /// The inputs are NOT authenticated contract account data.
    pub fn preview_analytics(
        env:Env,
        coll:Vec<CollateralInput>,debt:Vec<DebtInput>,
        perps:Vec<PerpInput>,orders:Vec<OrderInput>,
        pending_funding_e7:i128,caps:CapsInput,shock:StressInput,
    )->Result<AnalyticsView,GateError>{
        let (c,cn,d,dn,p,pn,o,on)=read_inputs(coll,debt,perps,orders)?;
        let portfolio=Portfolio{
            collateral:&c[..cn],debts:&d[..dn],perps:&p[..pn],
            orders:&o[..on],pending_funding_e7,
        };
        let result=m16::analyze(&portfolio,Policy::TEST_POLICY,
            env.ledger().timestamp(),shock.math(),caps.math())?;
        Ok(AnalyticsView{
            baseline:view(result.base),
            stressed:view(result.stressed),
            cap_flags:result.cap.flags,
            largest_market_notional_e7:result.cap.largest_market_notional_e7,
            order_reserve_e7:result.cap.order_initial_reserved_e7,
            leverage_bps:result.cap.leverage_bps,
            concentration_bps:result.cap.concentration_bps,
            reduce_only_recommended:result.reduce_only_recommended,
            execution_permitted:false,
        })
    }
    /// Approximate first unsafe mark for one market while holding every
    /// other snapshot price constant. NOT a liquidator trigger/price oracle.
    pub fn preview_liquidation(
        env:Env,
        coll:Vec<CollateralInput>,debt:Vec<DebtInput>,
        perps:Vec<PerpInput>,orders:Vec<OrderInput>,
        pending_funding_e7:i128,market_id:u32,
    )->Result<LiquidationView,GateError>{
        let (c,cn,d,dn,p,pn,o,on)=read_inputs(coll,debt,perps,orders)?;
        let portfolio=Portfolio{
            collateral:&c[..cn],debts:&d[..dn],perps:&p[..pn],
            orders:&o[..on],pending_funding_e7,
        };
        let q=m16::estimate_liquidation(&portfolio,Policy::TEST_POLICY,
            env.ledger().timestamp(),market_id)?;
        Ok(LiquidationView{
            market_id:q.market_id,current_mark_e7:q.current_mark_e7,
            first_unsafe_mark_e7:q.first_unsafe_mark_e7,
            already_liquidatable:q.already_liquidatable,
            execution_permitted:false,
        })
    }
    /// Always rejects until canonical live M5/M6/M8/M10/M12 integrations pass audit.
    pub fn authorize_trade() -> Result<(), GateError> { Err(GateError::NotIntegrated) }
    /// Always rejects; no custody transfers are possible from this contract.
    pub fn authorize_withdrawal() -> Result<(), GateError> { Err(GateError::NotIntegrated) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_math_is_onchain_but_snapshot_untrusted() {
        let env=Env::default();
        let contract=env.register(RiskGate,());
        let client=RiskGateClient::new(&env,&contract);
        let mut collateral=Vec::new(&env);
        collateral.push_back(CollateralInput {
            asset_id:1,amount_e7:200*10_000_000,price_e7:10_000_000,
            price_time_sec:0,collateral_factor_bps:9000,
        });
        let mut debts=Vec::new(&env);
        debts.push_back(DebtInput {asset_id:1,amount_with_interest_e7:100*10_000_000,
            price_e7:10_000_000,price_time_sec:0});
        let report=client.preview(&collateral,&debts,&Vec::new(&env),&Vec::new(&env),&0);
        assert_eq!(report.equity_e7,80*10_000_000);
        assert_eq!(report.initial_margin_e7,20*10_000_000);
        assert_eq!(report.available_margin_e7,60*10_000_000);
        assert!(!report.execution_permitted);
        assert!(!client.authorization_enabled());
        let after=client.preview_withdraw(&collateral,&debts,&Vec::new(&env),&Vec::new(&env),&0,&1,&(70*10_000_000));
        assert_eq!(after.state,1); // initial margin breach
        assert!(!after.execution_permitted);
    }
    #[test]
    fn empty_preview_cannot_create_executable_margin() {
        let env=Env::default();
        let contract=env.register(RiskGate,());
        let client=RiskGateClient::new(&env,&contract);
        let report=client.preview(&Vec::new(&env),&Vec::new(&env),&Vec::new(&env),&Vec::new(&env),&0);
        assert_eq!(report.state,0);
        assert_eq!(report.available_margin_e7,0);
        assert!(!report.execution_permitted);
    }
    #[test]
    fn m16_portfolio_analysis_aggregates_multi_product_snapshots_without_execution(){
        let e=Env::default();
        let id=e.register(RiskGate,());
        let cli=RiskGateClient::new(&e,&id);
        let mut coll=Vec::new(&e);
        coll.push_back(CollateralInput{asset_id:1,amount_e7:200*10_000_000,
            price_e7:10_000_000,price_time_sec:0,collateral_factor_bps:9000});
        let mut debt=Vec::new(&e);
        debt.push_back(DebtInput{asset_id:1,amount_with_interest_e7:30*10_000_000,
            price_e7:10_000_000,price_time_sec:0});
        let mut perps=Vec::new(&e);
        perps.push_back(PerpInput{market_id:1,signed_size_e7:10*10_000_000,
            entry_price_e7:10*10_000_000,mark_price_e7:10*10_000_000,
            mark_time_sec:0,initial_margin_bps:2500,maintenance_margin_bps:1500});
        let mut orders=Vec::new(&e);
        orders.push_back(OrderInput{order_id:1,initial_reserve_e7:10*10_000_000,
            maintenance_reserve_e7:5*10_000_000});
        let caps=CapsInput{
            max_market_notional_e7:500*10_000_000,
            max_total_notional_e7:600*10_000_000,
            max_debt_e7:500*10_000_000,
            max_order_initial_e7:100*10_000_000,
            max_leverage_bps:50_000,
            max_concentration_bps:10_000,
        };
        let shock=StressInput{
            collateral_price_drop_bps:2000,debt_price_rise_bps:1000,
            perp_adverse_mark_bps:1000,added_funding_loss_e7:0,
        };
        let x=cli.preview_analytics(&coll,&debt,&perps,&orders,&0,&caps,&shock);
        assert_eq!(x.baseline.adjusted_collateral_e7,180*10_000_000);
        assert_eq!(x.baseline.debt_e7,30*10_000_000);
        assert_eq!(x.baseline.notional_e7,100*10_000_000);
        assert_eq!(x.cap_flags,0);
        assert!(x.stressed.equity_e7<x.baseline.equity_e7);
        assert!(!x.execution_permitted);
        assert!(!x.baseline.execution_permitted);
        assert!(!cli.authorization_enabled());
        assert!(cli.try_authorize_trade().is_err());
    }
    #[test]
    fn m16_liquidation_estimate_is_hypothetical_and_read_only(){
        let e=Env::default();
        let id=e.register(RiskGate,());
        let cli=RiskGateClient::new(&e,&id);
        let mut coll=Vec::new(&e);
        coll.push_back(CollateralInput{asset_id:1,amount_e7:35*10_000_000,
            price_e7:10_000_000,price_time_sec:0,collateral_factor_bps:10_000});
        let mut perps=Vec::new(&e);
        perps.push_back(PerpInput{market_id:123,signed_size_e7:10*10_000_000,
            entry_price_e7:10*10_000_000,mark_price_e7:10*10_000_000,
            mark_time_sec:0,initial_margin_bps:2500,maintenance_margin_bps:1500});
        let empty:Vec<DebtInput>=Vec::new(&e);
        let orders:Vec<OrderInput>=Vec::new(&e);
        let q=cli.preview_liquidation(&coll,&empty,&perps,&orders,&0,&123);
        assert!(q.first_unsafe_mark_e7.unwrap()<10*10_000_000);
        assert!(!q.already_liquidatable);
        assert!(!q.execution_permitted);
        assert!(cli.try_preview_liquidation(&coll,&empty,&perps,&orders,&0,&888).is_err());
    }
    #[test]
    fn m16_stale_or_adversarial_input_does_not_turn_on_risk_execution(){
        let e=Env::default();
        let id=e.register(RiskGate,());
        let cli=RiskGateClient::new(&e,&id);
        let mut coll=Vec::new(&e);
        coll.push_back(CollateralInput{asset_id:1,amount_e7:100*10_000_000,
            price_e7:10_000_000,price_time_sec:0,collateral_factor_bps:9000});
        let caps=CapsInput{
            max_market_notional_e7:100*10_000_000,max_total_notional_e7:100*10_000_000,
            max_debt_e7:100*10_000_000,max_order_initial_e7:100*10_000_000,
            max_leverage_bps:20_000,max_collateral_concentration_bps:10_000};
        let shock=StressInput{collateral_price_drop_bps:9000,
            debt_price_rise_bps:0,perp_adverse_mark_bps:0,added_funding_loss_e7:0};
        let no_debt=Vec::new(&e);
        let no_perps=Vec::new(&e);
        let no_orders=Vec::new(&e);
        assert!(cli.try_preview_analytics(&coll,&no_debt,&no_perps,&no_orders,&0,&caps,&shock).is_err());
        assert!(!cli.authorization_enabled());
        assert!(cli.try_authorize_withdrawal().is_err());
    }

}
