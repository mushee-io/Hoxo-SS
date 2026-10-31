//! M13 — bounded bilateral funding and isolated fee/reconciliation accounting.
//! No external payout. No artificial yields. No off-chain caller prices.
//! Requires a CURRENT Soroban oracle, previously approved by an independent audit.
//! Funding is paid only from margin escrow, not from debt or M6 vault balances.
use super::*;
use soroban_sdk::{contracttype,Env};
pub const FUNDING_INTERVAL_SEC:u64=28_800; // 8h; no hidden catch-up approximation.
pub const MAX_FEE_BPS:u32=10; // maximum 0.10% per side per opening/closing
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct FeeLedger {
    pub fee_bps:u32,
    pub fees_accrued_e7:i128,
    pub cumulative_funding_to_short_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Reconciliation {
    pub actual_cash_e7:i128,
    pub user_claims_e7:i128,
    pub accrued_fees_e7:i128,
    pub surplus_e7:i128,
    pub open_positions:u32,
    pub solvent:bool,
}
pub fn init(e:&Env){
    e.storage().instance().set(&Key::Fees,&FeeLedger{
        fee_bps:0,fees_accrued_e7:0,cumulative_funding_to_short_e7:0
    });
}
pub fn ledger(e:&Env)->FeeLedger{
    e.storage().instance().get(&Key::Fees).expect("M13 fee ledger missing")
}
pub fn save(e:&Env,f:&FeeLedger){
    e.storage().instance().set(&Key::Fees,f);
    keep_instance(e);
}
pub fn opening_or_closing_fee(qty:i128,mark:i128,bps:u32)->Result<i128,PerpError>{
    if bps>MAX_FEE_BPS{return Err(PerpError::InvalidFee);}
    if bps==0{return Ok(0);}
    ceil(mul(notional(qty,mark)?,i128::from(bps))?,BPS)
}
/// The sign is + when longs pay shorts, - when shorts pay longs.
/// Index/mark deviation already bounded by require_price(). Never charge
/// more than one current 8-hour funding window as if it were historical.
pub fn funding_due(p:&Position,q:&Price,now:u64)->Result<i128,PerpError>{
    if now<p.last_funding_sec{return Err(PerpError::StalePrice);}
    let elapsed=now-p.last_funding_sec;
    if elapsed>FUNDING_INTERVAL_SEC{return Err(PerpError::FundingOverdue);}
    if elapsed==0||q.mark_e7==q.index_e7{return Ok(0);}
    let spread=q.mark_e7.checked_sub(q.index_e7).ok_or(PerpError::Overflow)?;
    let signed=mul(mul(p.base_quantity_e7,spread)?,i128::from(elapsed))?;
    Ok(signed/(SCALE*i128::from(FUNDING_INTERVAL_SEC)))
}
pub fn funding_step(
    e:&Env,position:&Position,price:&Price
)->Result<(Position,Wallet,Wallet,i128),PerpError>{
    if !position.active{return Err(PerpError::PositionClosed);}
    let now=e.ledger().timestamp();
    let transfer=funding_due(position,price,now)?;
    let mut pos=position.clone();
    let mut wl=wallet(e,&pos.long);
    let mut ws=wallet(e,&pos.short);
    if wl.locked_e7<pos.long_margin_e7||ws.locked_e7<pos.short_margin_e7{
        return Err(PerpError::Insolvent);
    }
    // Positive payment: decrease long locked, increase short locked.
    let new_long=pos.long_margin_e7.checked_sub(transfer).ok_or(PerpError::Overflow)?;
    let new_short=pos.short_margin_e7.checked_add(transfer).ok_or(PerpError::Overflow)?;
    if new_long<0||new_short<0{return Err(PerpError::LossExceedsMargin);}
    if transfer!=0{
        // Unsettled mark-to-market PnL must not make either side under
        // maintenance margin. M14 liquidation not yet implemented.
        let mtm=mul(pos.base_quantity_e7,
            price.mark_e7.checked_sub(pos.entry_price_e7).ok_or(PerpError::Overflow)?)?/SCALE;
        let min=ceil(mul(notional(pos.base_quantity_e7,price.mark_e7)?,MAINT_MARGIN_BPS)?,BPS)?;
        if new_long.checked_add(mtm).ok_or(PerpError::Overflow)?<min||
            new_short.checked_sub(mtm).ok_or(PerpError::Overflow)?<min{
            return Err(PerpError::MaintenanceBreach);
        }
    }
    wl.locked_e7=wl.locked_e7.checked_sub(transfer).ok_or(PerpError::Overflow)?;
    ws.locked_e7=ws.locked_e7.checked_add(transfer).ok_or(PerpError::Overflow)?;
    pos.long_margin_e7=new_long;
    pos.short_margin_e7=new_short;
    pos.last_funding_sec=now;
    pos.cumulative_funding_to_short_e7=pos.cumulative_funding_to_short_e7
        .checked_add(transfer).ok_or(PerpError::Overflow)?;
    Ok((pos,wl,ws,transfer))
}
pub fn reconcile(e:&Env)->Result<Reconciliation,PerpError>{
    let t=totals(e);
    let fees=ledger(e);
    if t.total_user_claims_e7<0||fees.fees_accrued_e7<0{return Err(PerpError::Insolvent);}
    let total=t.total_user_claims_e7.checked_add(fees.fees_accrued_e7)
        .ok_or(PerpError::Overflow)?;
    let actual=token::TokenClient::new(e,&collateral(e))
        .balance(&e.current_contract_address());
    let solvent=actual>=total;
    Ok(Reconciliation{
        actual_cash_e7:actual,user_claims_e7:t.total_user_claims_e7,
        accrued_fees_e7:fees.fees_accrued_e7,
        surplus_e7:if solvent{actual-total}else{0},
        open_positions:t.open_positions,solvent
    })
}
