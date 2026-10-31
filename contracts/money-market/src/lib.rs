#![no_std]
//! Hoxo SS M10: SINGLE-ASSET, SUPPLY-ONLY Stellar Testnet money market.
//! - Owner-authorised deposits/withdrawals, shares, exact token transfers.
//! - Conservative reserve accounting, no fictional interest or yield.
//! - A pure kinked utilization-rate quote for future M11 borrowing.
//! - NO borrowing, NO cross-product collateral reuse, NO admin fund sweep.
//!
//! Read-only interest indices remain 1.0 until audited M11 debt exists.
//! Archived Soroban storage requires a keeper/restore runbook before public use.
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    token, Address, BytesN, Env,
};

const SCALE:i128=10_000_000;
const BPS:i128=10_000;
const MAX_SUPPLY:i128=10_000_000_000_000_000; // 1 billion asset tokens, 7 decimals.
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
const TESTNET_ID:[u8;32]=[
    0xce,0xe0,0x30,0x2d,0x59,0x84,0x4d,0x32,
    0xbd,0xca,0x91,0x5c,0x82,0x03,0xdd,0x44,
    0xb3,0x3f,0xbb,0x7e,0xdc,0x19,0x05,0x1e,
    0xa3,0x7a,0xbe,0xdf,0x28,0xec,0xd4,0x72,
];

#[contracttype]
#[derive(Clone)]
pub enum Key { Admin, Asset, Pause, SupplyCap, Pool, Shares(Address) }

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolState {
    pub cash_e7:i128,
    pub total_shares_e7:i128,
    pub borrowed_e7:i128,
    pub protocol_reserves_e7:i128,
    pub borrow_index_e7:i128,
    pub supply_index_e7:i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rates {
    pub utilization_bps:u32,
    pub borrow_apr_bps:u32,
    pub supply_apr_bps:u32,
    pub reserve_factor_bps:u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub asset:Address,
    pub cash_e7:i128,
    pub total_shares_e7:i128,
    pub total_borrowed_e7:i128,
    pub protocol_reserves_e7:i128,
    pub exchange_rate_e7:i128,
    pub borrow_index_e7:i128,
    pub supply_index_e7:i128,
    pub supply_cap_e7:i128,
    pub deposits_paused:bool,
    pub borrowing_enabled:bool,
    pub rates:Rates,
}

#[contractevent(topics = ["hoxo_supply", "deposit"], data_format = "vec")]
#[derive(Clone, Debug)]
pub struct SupplyDeposited {
    #[topic]
    pub owner:Address,
    pub token_amount_e7:i128,
    pub minted_shares_e7:i128,
}

#[contractevent(topics = ["hoxo_supply", "withdraw"], data_format = "vec")]
#[derive(Clone, Debug)]
pub struct SupplyWithdrawn {
    #[topic]
    pub owner:Address,
    pub token_amount_e7:i128,
    pub burned_shares_e7:i128,
}

#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum PoolError {
    WrongNetwork=1,
    InvalidAsset=2,
    InvalidAmount=3,
    Paused=4,
    SupplyCap=5,
    Insolvent=6,
    InsufficientShares=7,
    InsufficientLiquidity=8,
    ZeroShares=9,
    Overflow=10,
    InvalidUtilization=11,
    BorrowingDisabled=12,
    LastShareCash=13,
}

fn admin(e:&Env)->Address{
    e.storage().instance().get(&Key::Admin).expect("pool not constructed")
}
fn asset(e:&Env)->Address{
    e.storage().instance().get(&Key::Asset).expect("pool not constructed")
}
fn pool(e:&Env)->PoolState{
    e.storage().instance().get(&Key::Pool).expect("pool not constructed")
}
fn keep_instance(e:&Env){
    e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
}
fn share(e:&Env,owner:&Address)->i128{
    e.storage().persistent().get(&Key::Shares(owner.clone())).unwrap_or(0)
}
fn store_share(e:&Env,owner:&Address,amount:i128){
    let k=Key::Shares(owner.clone());
    e.storage().persistent().set(&k,&amount);
    e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
}
fn require_testnet(e:&Env)->Result<(),PoolError>{
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(PoolError::WrongNetwork)
    }else{Ok(())}
}
fn total_assets(state:&PoolState)->Result<i128,PoolError>{
    state.cash_e7.checked_add(state.borrowed_e7)
        .and_then(|x|x.checked_sub(state.protocol_reserves_e7))
        .ok_or(PoolError::Overflow)
}
fn ceil_div_pos(n:i128,d:i128)->Result<i128,PoolError>{
    if n<0||d<=0{return Err(PoolError::InvalidAmount);}
    let q=n/d;
    if n%d>0{q.checked_add(1).ok_or(PoolError::Overflow)}else{Ok(q)}
}
fn checked_mul(a:i128,b:i128)->Result<i128,PoolError>{
    a.checked_mul(b).ok_or(PoolError::Overflow)
}
fn rate_quote(assets:i128,borrowed:i128,reserve_factor_bps:u32)->Result<Rates,PoolError>{
    if assets<0||borrowed<0||borrowed>assets||reserve_factor_bps>10000{
        return Err(PoolError::InvalidUtilization);
    }
    let util=if assets==0{0}else{checked_mul(borrowed,BPS)?/assets};
    // Illustrative ANNUAL rate model, not risk-approved:
    // base 2%, optimal utilization 80%, slope1 +8%, slope2 +70%.
    let apr=if util<=8000 {
        200+checked_mul(util,800)?/8000
    }else{
        1000+checked_mul(util-8000,7000)?/2000
    };
    // Supply yield is mathematically ZERO until real borrow interest exists.
    let supply=checked_mul(checked_mul(apr,util)?,BPS-i128::from(reserve_factor_bps))?/(BPS*BPS);
    Ok(Rates{
        utilization_bps:util as u32,borrow_apr_bps:apr as u32,
        supply_apr_bps:supply as u32,reserve_factor_bps
    })
}
fn exchange_rate(state:&PoolState)->Result<i128,PoolError>{
    if state.total_shares_e7==0{return Ok(SCALE);}
    checked_mul(total_assets(state)?,SCALE).map(|n|n/state.total_shares_e7)
}
fn ensure_cash(e:&Env,state:&PoolState)->Result<(),PoolError>{
    if state.cash_e7<0||state.total_shares_e7<0||
       state.borrowed_e7!=0||state.protocol_reserves_e7!=0||
       state.borrow_index_e7!=SCALE||state.supply_index_e7!=SCALE {
        return Err(PoolError::BorrowingDisabled);
    }
    let actual=token::TokenClient::new(e,&asset(e))
        .balance(&e.current_contract_address());
    if actual<state.cash_e7{return Err(PoolError::Insolvent);}
    Ok(())
}
fn deposit_share_quote(state:&PoolState,amount:i128)->Result<i128,PoolError>{
    if amount<=0{return Err(PoolError::InvalidAmount);}
    if state.total_shares_e7==0{return Ok(amount);}
    let assets=total_assets(state)?;
    if assets<=0{return Err(PoolError::Insolvent);}
    // Floor on mint: never grant fractional extra ownership.
    let minted=checked_mul(amount,state.total_shares_e7)?/assets;
    if minted==0{return Err(PoolError::ZeroShares);}
    Ok(minted)
}

#[contract]
pub struct MoneyMarket;

#[contractimpl]
impl MoneyMarket {
    pub fn __constructor(e:Env,owner:Address,token_address:Address){
        if require_testnet(&e).is_err(){panic!("HOXO M10 must deploy to Stellar Testnet");}
        owner.require_auth();
        if token::TokenClient::new(&e,&token_address).decimals()!=7{
            panic!("HOXO M10 requires 7-decimal token");
        }
        e.storage().instance().set(&Key::Admin,&owner);
        e.storage().instance().set(&Key::Asset,&token_address);
        // Starts PAUSED. Admin must explicitly review the test asset.
        e.storage().instance().set(&Key::Pause,&true);
        e.storage().instance().set(&Key::SupplyCap,&MAX_SUPPLY);
        e.storage().instance().set(&Key::Pool,&PoolState{
            cash_e7:0,total_shares_e7:0,borrowed_e7:0,
            protocol_reserves_e7:0,
            borrow_index_e7:SCALE,supply_index_e7:SCALE
        });
        keep_instance(&e);
    }
    pub fn asset(e:Env)->Address{asset(&e)}
    pub fn admin(e:Env)->Address{admin(&e)}
    pub fn deposits_paused(e:Env)->bool{
        e.storage().instance().get(&Key::Pause).unwrap_or(true)
    }
    pub fn borrowing_enabled()->bool{false}
    pub fn pause(e:Env,paused:bool){
        admin(&e).require_auth();
        e.storage().instance().set(&Key::Pause,&paused);
        keep_instance(&e);
    }
    pub fn set_supply_cap(e:Env,cap_e7:i128)->Result<(),PoolError>{
        admin(&e).require_auth();
        if cap_e7<=0||cap_e7>MAX_SUPPLY{return Err(PoolError::SupplyCap);}
        if cap_e7<pool(&e).cash_e7{return Err(PoolError::SupplyCap);}
        e.storage().instance().set(&Key::SupplyCap,&cap_e7);
        keep_instance(&e);
        Ok(())
    }
    pub fn transfer_admin(e:Env,next:Address){
        admin(&e).require_auth();
        next.require_auth();
        e.storage().instance().set(&Key::Admin,&next);
        keep_instance(&e);
    }
    pub fn share_balance(e:Env,owner:Address)->i128{share(&e,&owner)}
    pub fn pool(e:Env)->PoolView{
        let p=pool(&e);
        PoolView{
            asset:asset(&e),cash_e7:p.cash_e7,
            total_shares_e7:p.total_shares_e7,
            total_borrowed_e7:p.borrowed_e7,
            protocol_reserves_e7:p.protocol_reserves_e7,
            exchange_rate_e7:exchange_rate(&p).expect("invalid state"),
            borrow_index_e7:p.borrow_index_e7,
            supply_index_e7:p.supply_index_e7,
            supply_cap_e7:e.storage().instance().get(&Key::SupplyCap).unwrap_or(0),
            deposits_paused:Self::deposits_paused(e.clone()),
            borrowing_enabled:false,
            rates:rate_quote(total_assets(&p).expect("invalid state"),p.borrowed_e7,1000)
                .expect("invalid utilization"),
        }
    }
    /// Hypothetical rate-model quote only. It cannot alter real pool debt,
    /// interest index, or accrued user yield.
    pub fn preview_rates(total_assets_e7:i128,borrowed_e7:i128,reserve_factor_bps:u32)
        ->Result<Rates,PoolError>{
        rate_quote(total_assets_e7,borrowed_e7,reserve_factor_bps)
    }
    pub fn preview_supply(e:Env,amount_e7:i128)->Result<i128,PoolError>{
        deposit_share_quote(&pool(&e),amount_e7)
    }
    pub fn supply(e:Env,owner:Address,amount_e7:i128)->Result<i128,PoolError>{
        require_testnet(&e)?;
        owner.require_auth();
        if Self::deposits_paused(e.clone()){return Err(PoolError::Paused);}
        let mut p=pool(&e);
        ensure_cash(&e,&p)?;
        let minted=deposit_share_quote(&p,amount_e7)?;
        let new_cash=p.cash_e7.checked_add(amount_e7).ok_or(PoolError::Overflow)?;
        let cap:i128=e.storage().instance().get(&Key::SupplyCap).unwrap_or(0);
        if new_cash>cap{return Err(PoolError::SupplyCap);}
        let new_shares=p.total_shares_e7.checked_add(minted).ok_or(PoolError::Overflow)?;
        let user_new=share(&e,&owner).checked_add(minted).ok_or(PoolError::Overflow)?;
        let tok=token::TokenClient::new(&e,&asset(&e));
        let vault=e.current_contract_address();
        let actual_before=tok.balance(&vault);
        tok.transfer(&owner,&vault,&amount_e7);
        let actual_after=tok.balance(&vault);
        if actual_after.checked_sub(actual_before)!=Some(amount_e7)||
           actual_after<new_cash{return Err(PoolError::Insolvent);}
        p.cash_e7=new_cash;
        p.total_shares_e7=new_shares;
        store_share(&e,&owner,user_new);
        e.storage().instance().set(&Key::Pool,&p);
        keep_instance(&e);
        SupplyDeposited{owner,token_amount_e7:amount_e7,minted_shares_e7:minted}.publish(&e);
        Ok(minted)
    }
    /// Redeem an exact quantity of pool shares for underlying pool assets.
    /// No phantom accrued yield is included. Unlike supply, redemptions
    /// remain possible when deposits are paused.
    pub fn redeem(e:Env,owner:Address,shares_e7:i128)->Result<i128,PoolError>{
        require_testnet(&e)?;
        owner.require_auth();
        if shares_e7<=0{return Err(PoolError::InvalidAmount);}
        let mut p=pool(&e);
        ensure_cash(&e,&p)?;
        let held=share(&e,&owner);
        if held<shares_e7{return Err(PoolError::InsufficientShares);}
        if p.total_shares_e7<=0{return Err(PoolError::Insolvent);}
        let amount=checked_mul(shares_e7,total_assets(&p)?)?/p.total_shares_e7;
        if amount<=0{return Err(PoolError::ZeroShares);}
        if amount>p.cash_e7{return Err(PoolError::InsufficientLiquidity);}
        let tok=token::TokenClient::new(&e,&asset(&e));
        let vault=e.current_contract_address();
        let before=tok.balance(&vault);
        p.cash_e7=p.cash_e7.checked_sub(amount).ok_or(PoolError::Overflow)?;
        p.total_shares_e7=p.total_shares_e7.checked_sub(shares_e7).ok_or(PoolError::Overflow)?;
        store_share(&e,&owner,held-shares_e7);
        e.storage().instance().set(&Key::Pool,&p);
        tok.transfer(&vault,&owner,&amount);
        let after=tok.balance(&vault);
        if after.checked_add(amount)!=Some(before)||after<p.cash_e7{
            return Err(PoolError::Insolvent);
        }
        keep_instance(&e);
        SupplyWithdrawn{owner,token_amount_e7:amount,burned_shares_e7:shares_e7}.publish(&e);
        Ok(amount)
    }
    /// Withdraw exact underlying amount. Burns ceil(amount * totalShares / cash).
    /// Reject if that would burn the final share but leave unowned tracked cash.
    pub fn withdraw(e:Env,owner:Address,amount_e7:i128)->Result<i128,PoolError>{
        require_testnet(&e)?;
        owner.require_auth();
        if amount_e7<=0{return Err(PoolError::InvalidAmount);}
        let mut p=pool(&e);
        ensure_cash(&e,&p)?;
        if amount_e7>p.cash_e7{return Err(PoolError::InsufficientLiquidity);}
        if p.total_shares_e7<=0{return Err(PoolError::Insolvent);}
        let burned=ceil_div_pos(checked_mul(amount_e7,p.total_shares_e7)?,total_assets(&p)?)?;
        if burned<=0{return Err(PoolError::ZeroShares);}
        let held=share(&e,&owner);
        if held<burned{return Err(PoolError::InsufficientShares);}
        if burned==p.total_shares_e7&&amount_e7!=p.cash_e7{
            return Err(PoolError::LastShareCash);
        }
        let tok=token::TokenClient::new(&e,&asset(&e));
        let vault=e.current_contract_address();
        let before=tok.balance(&vault);
        p.cash_e7=p.cash_e7.checked_sub(amount_e7).ok_or(PoolError::Overflow)?;
        p.total_shares_e7=p.total_shares_e7.checked_sub(burned).ok_or(PoolError::Overflow)?;
        store_share(&e,&owner,held-burned);
        e.storage().instance().set(&Key::Pool,&p);
        tok.transfer(&vault,&owner,&amount_e7);
        let after=tok.balance(&vault);
        if after.checked_add(amount_e7)!=Some(before)||after<p.cash_e7{
            return Err(PoolError::Insolvent);
        }
        keep_instance(&e);
        SupplyWithdrawn{owner,token_amount_e7:amount_e7,burned_shares_e7:burned}.publish(&e);
        Ok(burned)
    }
    /// M11 placeholder that MUST NOT grant a loan, write principal or increase
    /// utilization until canonical oracle/risk checks are enforced atomically.
    pub fn borrow_disabled()->Result<(),PoolError>{
        Err(PoolError::BorrowingDisabled)
    }
    pub fn solvent(e:Env)->bool{
        let p=pool(&e);
        p.borrowed_e7==0&&p.protocol_reserves_e7==0&&
        token::TokenClient::new(&e,&asset(&e)).balance(&e.current_contract_address())>=p.cash_e7
    }
    /// Permissionless keeper call; persistent share entry may have been
    /// archived before this is called and then needs explicit restoration.
    pub fn keepalive(e:Env,owner:Address){
        let k=Key::Shares(owner);
        if e.storage().persistent().has(&k){
            e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
        }
        keep_instance(&e);
    }
}
#[cfg(test)]
mod tests;
