//! M14 — isolated perpetual liquidation, prefunded insurance and bad-debt PREVIEW.
//! Never spend other depositors' collateral. Never mint a winner's payout.
//! An uncovered insurance shortfall blocks settlement and remains visible
//! in a read-only quote, rather than silently socialising losses.
//! Historical funding >8h still fails closed: no fake backfilled TWAP.
use super::*;
use soroban_sdk::{contracttype,Env};
pub const MAX_REWARD_BPS:u32=50; // 0.5% of reduced notional
pub const MAX_PARTIAL_BPS:i128=5000; // max 50% per keeper reduction
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct InsuranceState {
    pub reserves_e7:i128,
    pub contributed_e7:i128,
    pub used_e7:i128,
    pub keeper_reward_bps:u32,
    pub liquidations:u32,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct LiquidationPreview {
    pub required:bool,
    pub mark_e7:i128,
    pub maintenance_e7:i128,
    pub long_equity_e7:i128,
    pub short_equity_e7:i128,
    pub insurance_available_e7:i128,
    pub required_insurance_e7:i128,
    pub uncovered_bad_debt_e7:i128,
    pub can_full_liquidate:bool,
    pub remaining_base_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct LiquidationResult {
    pub position_id:BytesN<32>,
    pub fully_closed:bool,
    pub quantity_closed_e7:i128,
    pub remaining_base_e7:i128,
    pub keeper_reward_e7:i128,
    pub insurance_used_e7:i128,
    pub uncovered_bad_debt_e7:i128, // always 0 for an executable settlement
    pub realised_long_pnl_e7:i128,
}
pub fn init(e:&Env){
    e.storage().instance().set(&Key::Insurance,&InsuranceState{
        reserves_e7:0,contributed_e7:0,used_e7:0,
        keeper_reward_bps:0,liquidations:0
    });
}
pub fn insurance(e:&Env)->InsuranceState{
    e.storage().instance().get(&Key::Insurance).expect("M14 state missing")
}
pub fn save(e:&Env,state:&InsuranceState){
    e.storage().instance().set(&Key::Insurance,state);
    keep_instance(e);
}
pub fn marked(p:&Position,q:&Price,now:u64)->Result<(i128,i128,i128),PerpError>{
    let pnl=mul(p.base_quantity_e7,
        q.mark_e7.checked_sub(p.entry_price_e7).ok_or(PerpError::Overflow)?)?/SCALE;
    let funding=m13::funding_due(p,q,now)?;
    let net=pnl.checked_sub(funding).ok_or(PerpError::Overflow)?;
    Ok((pnl,funding,net))
}
pub fn quote(
    p:&Position,q:&Price,now:u64,ins:&InsuranceState
)->Result<LiquidationPreview,PerpError>{
    if !p.active{return Err(PerpError::PositionClosed);}
    let (_,_,net)=marked(p,q,now)?;
    let long=p.long_margin_e7.checked_add(net).ok_or(PerpError::Overflow)?;
    let short=p.short_margin_e7.checked_sub(net).ok_or(PerpError::Overflow)?;
    let maintenance=ceil(mul(notional(p.base_quantity_e7,q.mark_e7)?,MAINT_MARGIN_BPS)?,BPS)?;
    let deficit=if long<0 {long.checked_neg().ok_or(PerpError::Overflow)?}
                else if short<0 {short.checked_neg().ok_or(PerpError::Overflow)?}
                else{0};
    if ins.reserves_e7<0{return Err(PerpError::Insolvent);}
    Ok(LiquidationPreview{
        required:long<maintenance||short<maintenance,
        mark_e7:q.mark_e7,maintenance_e7:maintenance,
        long_equity_e7:long,short_equity_e7:short,
        insurance_available_e7:ins.reserves_e7,
        required_insurance_e7:deficit,
        uncovered_bad_debt_e7:if deficit>ins.reserves_e7{deficit-ins.reserves_e7}else{0},
        can_full_liquidate:deficit<=ins.reserves_e7,
        remaining_base_e7:p.base_quantity_e7,
    })
}
fn reward(qty:i128,mark:i128,bps:u32,loser_payout:i128)->Result<i128,PerpError>{
    if bps>MAX_REWARD_BPS{return Err(PerpError::InvalidReward);}
    if bps==0||loser_payout<=0{return Ok(0);}
    Ok(ceil(mul(notional(qty,mark)?,i128::from(bps))?,BPS)?.min(loser_payout))
}
/// Conservative partial: realise a slice's PnL, then retain every remaining
/// token in the paired locked escrow except a bounded keeper reward.
/// It may only proceed if BOTH residual marked equities exceed maintenance.
/// No insurance is used for a partial; full settlement is separate.
pub fn partial(
    p:&Position,q:&Price,now:u64,qty:i128,reward_bps:u32
)->Result<(Position,i128,i128,i128),PerpError>{
    if qty<=0||qty>=p.base_quantity_e7||
       mul(qty,BPS)?>mul(p.base_quantity_e7,MAX_PARTIAL_BPS)?{
        return Err(PerpError::InvalidReduction);
    }
    let funding=m13::funding_due(p,q,now)?;
    let reduced_pnl=mul(qty,
        q.mark_e7.checked_sub(p.entry_price_e7).ok_or(PerpError::Overflow)?)?/SCALE;
    let delta=reduced_pnl.checked_sub(funding).ok_or(PerpError::Overflow)?;
    let mut lm=p.long_margin_e7.checked_add(delta).ok_or(PerpError::Overflow)?;
    let mut sm=p.short_margin_e7.checked_sub(delta).ok_or(PerpError::Overflow)?;
    if lm<0||sm<0{return Err(PerpError::InsuranceShortfall);}
    let keeper=reward(qty,q.mark_e7,reward_bps,if delta<0{lm}else{sm})?;
    if delta<0{lm-=keeper;}else{sm-=keeper;}
    let remains=p.base_quantity_e7-qty;
    let pending_pnl=mul(remains,
        q.mark_e7.checked_sub(p.entry_price_e7).ok_or(PerpError::Overflow)?)?/SCALE;
    let min=ceil(mul(notional(remains,q.mark_e7)?,MAINT_MARGIN_BPS)?,BPS)?;
    if lm.checked_add(pending_pnl).ok_or(PerpError::Overflow)?<min||
       sm.checked_sub(pending_pnl).ok_or(PerpError::Overflow)?<min{
        return Err(PerpError::PartialNotSafe);
    }
    let mut next=p.clone();
    next.base_quantity_e7=remains;
    next.long_margin_e7=lm;
    next.short_margin_e7=sm;
    next.last_funding_sec=now;
    next.cumulative_funding_to_short_e7=next.cumulative_funding_to_short_e7
        .checked_add(funding).ok_or(PerpError::Overflow)?;
    next.liquidated_quantity_e7=next.liquidated_quantity_e7
        .checked_add(qty).ok_or(PerpError::Overflow)?;
    next.liquidation_count=next.liquidation_count.checked_add(1).ok_or(PerpError::Overflow)?;
    next.cumulative_realised_pnl_e7=next.cumulative_realised_pnl_e7
        .checked_add(reduced_pnl).ok_or(PerpError::Overflow)?;
    Ok((next,keeper,reduced_pnl,funding))
}
/// Full liquidation exhausts ONLY this position's two isolated escrows.
/// Pre-funded insurance covers a negative loser payout before a winner is
/// credited. If the reserve cannot pay the exact deficit, REJECT.
pub fn full(
    p:&Position,q:&Price,now:u64,ins:&InsuranceState
)->Result<(Position,i128,i128,i128,i128,i128,i128),PerpError>{
    let (pnl,funding,net)=marked(p,q,now)?;
    let gross_long=p.long_margin_e7.checked_add(net).ok_or(PerpError::Overflow)?;
    let gross_short=p.short_margin_e7.checked_sub(net).ok_or(PerpError::Overflow)?;
    let shortfall=if gross_long<0{gross_long.checked_neg().ok_or(PerpError::Overflow)?}
             else if gross_short<0{gross_short.checked_neg().ok_or(PerpError::Overflow)?}
             else{0};
    if shortfall>ins.reserves_e7{return Err(PerpError::InsuranceShortfall);}
    let mut lp=gross_long.max(0);
    let mut sp=gross_short.max(0);
    let keeper=reward(p.base_quantity_e7,q.mark_e7,ins.keeper_reward_bps,
        if net<0{lp}else{sp})?;
    if net<0{lp-=keeper;}else{sp-=keeper;}
    let mut next=p.clone();
    next.active=false;
    next.closed_at_sec=now;
    next.close_price_e7=q.mark_e7;
    next.long_realised_pnl_e7=pnl;
    next.cumulative_realised_pnl_e7=next.cumulative_realised_pnl_e7
        .checked_add(pnl).ok_or(PerpError::Overflow)?;
    next.cumulative_funding_to_short_e7=next.cumulative_funding_to_short_e7
        .checked_add(funding).ok_or(PerpError::Overflow)?;
    next.liquidated_quantity_e7=next.liquidated_quantity_e7
        .checked_add(p.base_quantity_e7).ok_or(PerpError::Overflow)?;
    next.base_quantity_e7=0;
    next.long_margin_e7=0;
    next.short_margin_e7=0;
    next.last_funding_sec=now;
    next.liquidation_count=next.liquidation_count.checked_add(1).ok_or(PerpError::Overflow)?;
    Ok((next,lp,sp,shortfall,keeper,pnl,funding))
}
