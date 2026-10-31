#![no_std]
pub mod m16;
//! Hoxo SS M7 fixed-point portfolio risk arithmetic.
//! All numeric values are integer 10^7 units. No floating point, wrapping
//! arithmetic, heap allocation, unchecked oracle freshness or implicit rounding.
//! This library is PURE MATH; input authenticity is the caller's obligation.
pub const SCALE: i128 = 10_000_000;
pub const BPS: i128 = 10_000;
pub const MAX_ITEMS: usize = 16;
pub const MAX_PRICE_AGE_SEC: u64 = 120;
pub const FUTURE_SKEW_SEC: u64 = 15;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiskError {
    InvalidInput,
    Overflow,
    StalePrice,
    DuplicateKey,
    TooManyItems,
    InsufficientCollateral,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiskState {
    Healthy,
    InitialMarginBreach,
    Liquidatable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Collateral {
    pub asset: u32,
    pub amount: i128,
    pub price_e7: i128,
    pub price_time_sec: u64,
    pub factor_bps: u32,
}
impl Collateral {
    pub const ZERO: Self = Self { asset: 0, amount: 0, price_e7: 0, price_time_sec: 0, factor_bps: 0 };
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Debt {
    pub asset: u32,
    pub amount_including_interest: i128,
    pub price_e7: i128,
    pub price_time_sec: u64,
}
impl Debt {
    pub const ZERO: Self = Self { asset: 0, amount_including_interest: 0, price_e7: 0, price_time_sec: 0 };
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Perp {
    pub market: u32,
    pub signed_base_e7: i128,
    pub entry_e7: i128,
    pub mark_e7: i128,
    pub mark_time_sec: u64,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
}
impl Perp {
    pub const ZERO: Self = Self { market: 0, signed_base_e7: 0, entry_e7: 0, mark_e7: 0, mark_time_sec: 0, initial_margin_bps: 0, maintenance_margin_bps: 0 };
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrderReservation {
    pub order: u32,
    pub initial_e7: i128,
    pub maintenance_e7: i128,
}
impl OrderReservation {
    pub const ZERO: Self = Self { order: 0, initial_e7: 0, maintenance_e7: 0 };
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    pub debt_initial_bps: u32,
    pub debt_maintenance_bps: u32,
    pub max_age_sec: u64,
}
impl Policy {
    // ILLUSTRATIVE only. Not risk committee-approved leverage / collateral limits.
    pub const TEST_POLICY: Self = Self { debt_initial_bps: 2_000, debt_maintenance_bps: 1_000, max_age_sec: MAX_PRICE_AGE_SEC };
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RiskReport {
    pub gross_collateral_e7: i128,
    pub adjusted_collateral_e7: i128,
    pub debt_e7: i128,
    pub perp_notional_e7: i128,
    pub unrealized_pnl_e7: i128,
    pub pending_funding_e7: i128,
    pub initial_required_e7: i128,
    pub maintenance_required_e7: i128,
    pub equity_e7: i128,
    pub available_margin_e7: i128,
    pub health_bps: Option<i128>,
    pub state: RiskState,
}
pub struct Portfolio<'a> {
    pub collateral: &'a [Collateral],
    pub debts: &'a [Debt],
    pub perps: &'a [Perp],
    pub orders: &'a [OrderReservation],
    pub pending_funding_e7: i128, // signed: negative means accrued funding owed
}
fn mul(a: i128, b: i128) -> Result<i128, RiskError> { a.checked_mul(b).ok_or(RiskError::Overflow) }
fn add(a: i128, b: i128) -> Result<i128, RiskError> { a.checked_add(b).ok_or(RiskError::Overflow) }
fn sub(a: i128, b: i128) -> Result<i128, RiskError> { a.checked_sub(b).ok_or(RiskError::Overflow) }
fn ceil_pos(value: i128, divisor: i128) -> Result<i128, RiskError> {
    if value < 0 || divisor <= 0 { return Err(RiskError::InvalidInput); }
    let q = value / divisor;
    if value % divisor > 0 { add(q, 1) } else { Ok(q) }
}
fn floor_signed(value: i128, divisor: i128) -> Result<i128, RiskError> {
    if divisor <= 0 { return Err(RiskError::InvalidInput); }
    let q = value / divisor;
    if value < 0 && value % divisor != 0 { sub(q, 1) } else { Ok(q) }
}
fn bp_ceil(amount: i128, value: u32) -> Result<i128, RiskError> {
    ceil_pos(mul(amount, i128::from(value))?, BPS)
}
fn bp_floor(amount: i128, value: u32) -> Result<i128, RiskError> {
    Ok(mul(amount, i128::from(value))? / BPS)
}
fn ensure_age(now: u64, last: u64, max_age: u64) -> Result<(), RiskError> {
    if last > now.saturating_add(FUTURE_SKEW_SEC) || now.saturating_sub(last) > max_age {
        Err(RiskError::StalePrice)
    } else { Ok(()) }
}
fn no_dups<T>(data: &[T], key: impl Fn(&T) -> u32) -> bool {
    for i in 0..data.len() {
        if key(&data[i]) == 0 { return false; }
        for j in 0..i { if key(&data[i]) == key(&data[j]) { return false; } }
    }
    true
}
pub fn evaluate(portfolio: &Portfolio<'_>, policy: Policy, now_sec: u64) -> Result<RiskReport, RiskError> {
    if policy.max_age_sec == 0 || policy.max_age_sec > MAX_PRICE_AGE_SEC ||
        policy.debt_initial_bps > 10_000 || policy.debt_maintenance_bps > policy.debt_initial_bps {
        return Err(RiskError::InvalidInput);
    }
    if [portfolio.collateral.len(), portfolio.debts.len(), portfolio.perps.len(), portfolio.orders.len()]
        .iter().any(|n| *n > MAX_ITEMS) { return Err(RiskError::TooManyItems); }
    if !no_dups(portfolio.collateral, |c| c.asset) ||
        !no_dups(portfolio.debts, |d| d.asset) ||
        !no_dups(portfolio.perps, |p| p.market) ||
        !no_dups(portfolio.orders, |o| o.order) { return Err(RiskError::DuplicateKey); }

    let mut gross = 0i128;
    let mut adjusted = 0i128;
    for c in portfolio.collateral {
        if c.amount <= 0 || c.price_e7 <= 0 || c.factor_bps > 10_000 { return Err(RiskError::InvalidInput); }
        ensure_age(now_sec, c.price_time_sec, policy.max_age_sec)?;
        let value = mul(c.amount, c.price_e7)? / SCALE; // floor positive collateral
        gross = add(gross, value)?;
        adjusted = add(adjusted, bp_floor(value, c.factor_bps)?)?;
    }
    let mut debt = 0i128;
    for d in portfolio.debts {
        if d.amount_including_interest <= 0 || d.price_e7 <= 0 { return Err(RiskError::InvalidInput); }
        ensure_age(now_sec, d.price_time_sec, policy.max_age_sec)?;
        debt = add(debt, ceil_pos(mul(d.amount_including_interest, d.price_e7)?, SCALE)?)?;
    }
    let mut pnl = 0i128;
    let mut notional = 0i128;
    let mut initial = bp_ceil(debt, policy.debt_initial_bps)?;
    let mut maintenance = bp_ceil(debt, policy.debt_maintenance_bps)?;
    for p in portfolio.perps {
        if p.signed_base_e7 == 0 || p.entry_e7 <= 0 || p.mark_e7 <= 0 ||
           p.initial_margin_bps == 0 || p.initial_margin_bps > 10_000 ||
           p.maintenance_margin_bps == 0 || p.maintenance_margin_bps > p.initial_margin_bps {
            return Err(RiskError::InvalidInput);
        }
        ensure_age(now_sec, p.mark_time_sec, policy.max_age_sec)?;
        let abs_size = p.signed_base_e7.checked_abs().ok_or(RiskError::Overflow)?;
        let market_notional = ceil_pos(mul(abs_size, p.mark_e7)?, SCALE)?;
        notional = add(notional, market_notional)?;
        initial = add(initial, bp_ceil(market_notional, p.initial_margin_bps)?)?;
        maintenance = add(maintenance, bp_ceil(market_notional, p.maintenance_margin_bps)?)?;
        let diff = sub(p.mark_e7, p.entry_e7)?;
        pnl = add(pnl, floor_signed(mul(p.signed_base_e7, diff)?, SCALE)?)?;
    }
    for o in portfolio.orders {
        if o.initial_e7 < 0 || o.maintenance_e7 < 0 || o.maintenance_e7 > o.initial_e7 {
            return Err(RiskError::InvalidInput);
        }
        initial = add(initial, o.initial_e7)?;
        maintenance = add(maintenance, o.maintenance_e7)?;
    }
    let equity = add(sub(adjusted, debt)?, add(pnl, portfolio.pending_funding_e7)?)?;
    let margin = sub(equity, initial)?;
    let health_bps = if maintenance == 0 { None } else { Some(floor_signed(mul(equity, BPS)?, maintenance)?) };
    let state = if equity < 0 || (maintenance > 0 && equity < maintenance) {
        RiskState::Liquidatable
    } else if equity < initial { RiskState::InitialMarginBreach } else { RiskState::Healthy };
    Ok(RiskReport {
        gross_collateral_e7: gross, adjusted_collateral_e7: adjusted, debt_e7: debt,
        perp_notional_e7: notional, unrealized_pnl_e7: pnl,
        pending_funding_e7: portfolio.pending_funding_e7,
        initial_required_e7: initial, maintenance_required_e7: maintenance,
        equity_e7: equity, available_margin_e7: margin, health_bps, state,
    })
}
/// Read-only hypothetical preview; NOT a withdrawal authorization.
pub fn preview_withdrawal(
    portfolio: &Portfolio<'_>, policy: Policy, now_sec: u64,
    asset: u32, withdraw_e7: i128,
) -> Result<RiskReport, RiskError> {
    if withdraw_e7 <= 0 { return Err(RiskError::InvalidInput); }
    evaluate(portfolio, policy, now_sec)?; // validate entire pre-state
    let mut rows = [Collateral::ZERO; MAX_ITEMS];
    let mut found = false;
    let mut count = 0usize;
    for c in portfolio.collateral {
        if c.asset == asset {
            found = true;
            if c.amount < withdraw_e7 { return Err(RiskError::InsufficientCollateral); }
            if c.amount > withdraw_e7 {
                let mut remaining = *c;
                remaining.amount = sub(c.amount, withdraw_e7)?;
                rows[count] = remaining; count += 1;
            }
        } else {
            rows[count] = *c; count += 1;
        }
    }
    if !found { return Err(RiskError::InsufficientCollateral); }
    evaluate(&Portfolio {
        collateral: &rows[..count], debts: portfolio.debts, perps: portfolio.perps,
        orders: portfolio.orders, pending_funding_e7: portfolio.pending_funding_e7
    }, policy, now_sec)
}
