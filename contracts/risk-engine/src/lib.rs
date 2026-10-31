#![no_std]
//! HOXO SS M7 — on-chain PREVIEW risk gate, not an exchange.
//! Inputs are caller-supplied until canonical M5 oracle, M6 vault and
//! clearinghouse modules can provide authenticated state. As a result,
//! authorize_trade and authorize_withdrawal ALWAYS FAIL.
//! Oracle timestamps use the Soroban ledger clock; math uses 7-decimal ints.
use hoxo_risk_math::{
    evaluate, preview_withdrawal, Collateral as MathCollateral,
    Debt as MathDebt, OrderReservation as MathOrder,
    Perp as MathPerp, Policy, Portfolio, RiskError, RiskReport, RiskState, MAX_ITEMS,
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
        let report=client.preview(&Vec::new(&env),&Vec::new(&env),&Vec::new(&env),&0);
        assert_eq!(report.state,0);
        assert_eq!(report.available_margin_e7,0);
        assert!(!report.execution_permitted);
    }
}
