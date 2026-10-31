//! M11: on-chain debt shares, bounded interest accrual, conservative reserves.
//! Risk authority MUST read canonical on-chain collateral/oracle/positions.
//! M7 currently provides previews only; no deployable lending approval exists.
use super::*;
use soroban_sdk::{contractclient,contracttype,Address,Env};
pub const YEAR_SECS:i128=31_536_000;
pub const MAX_STEP:u64=30*86_400;
const DENOM:i128=BPS*YEAR_SECS;
#[contractclient(name="BorrowRiskClient")]
pub trait BorrowRisk {
    fn approve_borrow(env:Env,borrower:Address,market:Address,asset:Address,
        proposed_amount_e7:i128,projected_debt_e7:i128)->bool;
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct DebtState {
    pub total_debt_shares_e7:i128,
    pub last_accrual_sec:u64,
    pub index_remainder:i128,
    pub reserve_remainder:i128,
    pub debt_cap_e7:i128,
    pub max_utilization_bps:u32,
    pub reserve_factor_bps:u32,
    pub paused:bool,
    pub risk_authority:Option<Address>,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct BorrowState {
    pub borrowing_enabled:bool,
    pub paused:bool,
    pub risk_authority_configured:bool,
    pub outstanding_debt_e7:i128,
    pub debt_shares_e7:i128,
    pub debt_cap_e7:i128,
    pub max_utilization_bps:u32,
    pub reserve_factor_bps:u32,
    pub last_accrual_sec:u64,
}
#[contractevent(topics=["hoxo_debt","borrow"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct BorrowEvent {
    #[topic]
    pub borrower:Address,
    pub amount_e7:i128,
    pub debt_shares_e7:i128,
}
#[contractevent(topics=["hoxo_debt","repay"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct RepayEvent {
    #[topic]
    pub borrower:Address,
    pub payer:Address,
    pub amount_e7:i128,
    pub burned_shares_e7:i128,
}
pub fn init_debt(e:&Env){
    e.storage().instance().set(&Key::Debt,&DebtState{
        total_debt_shares_e7:0,last_accrual_sec:e.ledger().timestamp(),
        index_remainder:0,reserve_remainder:0,debt_cap_e7:0,
        max_utilization_bps:8000,reserve_factor_bps:1000,
        paused:true,risk_authority:None
    });
}
pub fn config(e:&Env)->DebtState{
    e.storage().instance().get(&Key::Debt).expect("M11 state missing")
}
pub fn store_config(e:&Env,d:&DebtState){
    e.storage().instance().set(&Key::Debt,d);keep_instance(e);
}
pub fn owner_shares(e:&Env,owner:&Address)->i128{
    e.storage().persistent().get(&Key::DebtShares(owner.clone())).unwrap_or(0)
}
pub fn store_owner_shares(e:&Env,owner:&Address,amount:i128){
    let k=Key::DebtShares(owner.clone());
    e.storage().persistent().set(&k,&amount);
    e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
}
pub fn owed(shares:i128,index:i128)->Result<i128,PoolError>{
    if shares<0||index<SCALE{return Err(PoolError::Insolvent);}
    ceil_div_pos(checked_mul(shares,index)?,SCALE)
}
pub fn update_supply_index(p:&mut PoolState)->Result<(),PoolError>{
    p.supply_index_e7=exchange_rate(p)?;
    Ok(())
}
/// Process one <=30-day interval. Larger dormancy requires permissionless
/// catch-up calls; never silently drop accrued interest.
pub fn compute(e:&Env,allow_partial:bool)->Result<(PoolState,DebtState),PoolError>{
    let mut p=pool(e);
    let mut d=config(e);
    let now=e.ledger().timestamp();
    if now<d.last_accrual_sec{return Err(PoolError::ClockRollback);}
    let gap=now-d.last_accrual_sec;
    // No outstanding principal: skip keeper catch-up without inventing interest.
    // Previous indexed debt may be closed, so do not charge new borrowers for
    // the elapsed idle period or strand suppliers behind stale timestamps.
    if d.total_debt_shares_e7==0 {
        if p.borrowed_e7!=0{return Err(PoolError::AccountingMismatch);}
        d.last_accrual_sec=now;
        d.index_remainder=0;
        return Ok((p,d));
    }
    if !allow_partial&&gap>MAX_STEP{return Err(PoolError::StaleAccrual);}
    let seconds=if allow_partial{gap.min(MAX_STEP)}else{gap};
    if seconds==0{return Ok((p,d));}
    let old=owed(d.total_debt_shares_e7,p.borrow_index_e7)?;
    if old!=p.borrowed_e7{return Err(PoolError::AccountingMismatch);}
    if d.total_debt_shares_e7>0{
        let r=rate_quote(total_assets(&p)?,p.borrowed_e7,d.reserve_factor_bps)?;
        let numerator=checked_mul(checked_mul(p.borrow_index_e7,i128::from(r.borrow_apr_bps))?,i128::from(seconds))?
            .checked_add(d.index_remainder).ok_or(PoolError::Overflow)?;
        p.borrow_index_e7=p.borrow_index_e7.checked_add(numerator/DENOM).ok_or(PoolError::Overflow)?;
        d.index_remainder=numerator%DENOM;
        let next=owed(d.total_debt_shares_e7,p.borrow_index_e7)?;
        if next<old{return Err(PoolError::AccountingMismatch);}
        let numerator=checked_mul(next-old,i128::from(d.reserve_factor_bps))?
            .checked_add(d.reserve_remainder).ok_or(PoolError::Overflow)?;
        p.protocol_reserves_e7=p.protocol_reserves_e7.checked_add(numerator/BPS).ok_or(PoolError::Overflow)?;
        d.reserve_remainder=numerator%BPS;
        p.borrowed_e7=next;
    }
    d.last_accrual_sec=d.last_accrual_sec.checked_add(seconds).ok_or(PoolError::Overflow)?;
    update_supply_index(&mut p)?;
    Ok((p,d))
}
pub fn accrue(e:&Env,allow_partial:bool)->Result<(PoolState,DebtState),PoolError>{
    let (p,d)=compute(e,allow_partial)?;
    e.storage().instance().set(&Key::Pool,&p);
    store_config(e,&d);
    Ok((p,d))
}
pub fn policy(cap:i128,max_util:u32,reserve:u32,current:i128)->Result<(),PoolError>{
    if cap<0||cap>MAX_SUPPLY||cap<current||max_util==0||max_util>9000||reserve>5000{
        return Err(PoolError::InvalidPolicy);
    }
    Ok(())
}
pub fn check_utilization(p:&PoolState,new_debt:i128,max_bps:u32)->Result<(),PoolError>{
    let a=total_assets(p)?;
    if a<=0||new_debt<0{return Err(PoolError::InsufficientLiquidity);}
    let util=ceil_div_pos(checked_mul(new_debt,BPS)?,a)?;
    if util>i128::from(max_bps){return Err(PoolError::UtilizationCap);}
    Ok(())
}
