#![no_std]
//! Hoxo SS M12–M14 - ISOLATED bilateral perpetual contract foundation.
//! Testnet ONLY. No synthetic USDC or external payout.
//! The "perp" is a matched long/short pair with isolated, on-chain
//! token escrow. Mark comes ONLY from an external Soroban oracle contract;
//! risk comes ONLY from a separate Soroban risk authority contract.
//! Both are initially unset; new positions and deposits start PAUSED.
//! M5 oracle/M7 canonical risk are NOT deployed. Never present as live.
use soroban_sdk::{
    contract,contractclient,contracterror,contractevent,contractimpl,
    contracttype,token,Address,BytesN,Env,
};
mod m13;
mod m14;
use m13::*;
use m14::*;
const SCALE:i128=10_000_000;
const BPS:i128=10_000;
const MAX_DEVIATION_BPS:i128=200;
const MAX_PRICE_AGE_SEC:u64=120;
const INITIAL_MARGIN_BPS:i128=2500; // 4x max illustrative leverage
const MAINT_MARGIN_BPS:i128=1500;
const MAX_NOTIONAL_E7:i128=1_000_000*SCALE;
const MAX_OPEN_POSITIONS:u32=1000;
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
const TESTNET_ID:[u8;32]=[
    0xce,0xe0,0x30,0x2d,0x59,0x84,0x4d,0x32,
    0xbd,0xca,0x91,0x5c,0x82,0x03,0xdd,0x44,
    0xb3,0x3f,0xbb,0x7e,0xdc,0x19,0x05,0x1e,
    0xa3,0x7a,0xbe,0xdf,0x28,0xec,0xd4,0x72,
];

#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Price {
    pub mark_e7:i128,
    pub index_e7:i128,
    pub updated_at_sec:u64,
}
#[contractclient(name="OracleClient")]
pub trait CanonicalOracle {
    fn current(env:Env,market_id:u32)->Price;
}
#[contractclient(name="MarginRiskClient")]
pub trait CanonicalRisk {
    // MUST derive portfolio collateral/debt/orders/positions itself, from
    // authenticated on-chain state; caller inputs are merely a request.
    fn approve_open(
        env:Env,owner:Address,clearinghouse:Address,
        market_id:u32,proposed_signed_base_e7:i128,
        requested_margin_e7:i128,mark_e7:i128
    )->bool;
}

#[contracttype]
#[derive(Clone)]
pub enum Key {
    Admin, Token, Market, Paused, Oracle, Risk, Totals, Fees, Insurance,
    Wallet(Address), Position(BytesN<32>),
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Wallet {
    pub available_e7:i128,
    pub locked_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Totals {
    pub total_user_claims_e7:i128,
    pub open_positions:u32,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Position {
    pub id:BytesN<32>,
    pub long:Address,
    pub short:Address,
    pub base_quantity_e7:i128,
    pub entry_price_e7:i128,
    pub initial_margin_each_e7:i128,
    pub long_margin_e7:i128,
    pub short_margin_e7:i128,
    pub last_funding_sec:u64,
    pub cumulative_funding_to_short_e7:i128,
    pub total_fees_paid_e7:i128,
    pub liquidated_quantity_e7:i128,
    pub cumulative_realised_pnl_e7:i128,
    pub liquidation_count:u32,
    pub opened_at_sec:u64,
    pub closed_at_sec:u64,
    pub close_price_e7:i128,
    pub long_realised_pnl_e7:i128,
    pub active:bool,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct MarketView {
    pub market_id:u32,
    pub collateral_token:Address,
    pub paused:bool,
    pub oracle_configured:bool,
    pub risk_configured:bool,
    pub entry_gate_configured:bool,
    pub initial_margin_bps:u32,
    pub maintenance_margin_bps:u32,
    pub total_user_claims_e7:i128,
    pub open_positions:u32,
    pub fee_bps:u32,
    pub accrued_fees_e7:i128,
    pub insurance_reserves_e7:i128,
    pub keeper_reward_bps:u32,
}
#[contractevent(topics=["hoxo_perp","opened"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Opened {
    #[topic]
    pub id:BytesN<32>,
    pub long:Address,
    pub short:Address,
    pub base_quantity_e7:i128,
    pub entry_price_e7:i128,
    pub margin_each_e7:i128,
}
#[contractevent(topics=["hoxo_perp","closed"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Closed {
    #[topic]
    pub id:BytesN<32>,
    pub close_price_e7:i128,
    pub long_realised_pnl_e7:i128,
    pub closed_at_sec:u64,
}
#[contractevent(topics=["hoxo_perp","funding"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct FundingSettled {
    #[topic]
    pub id:BytesN<32>,
    pub long_pays_short_e7:i128,
    pub timestamp_sec:u64,
}
#[contractevent(topics=["hoxo_perp","liquidation"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Liquidated {
    #[topic]
    pub id:BytesN<32>,
    pub keeper:Address,
    pub quantity_closed_e7:i128,
    pub fully_closed:bool,
    pub insurance_used_e7:i128,
    pub keeper_reward_e7:i128,
}
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum PerpError {
    WrongNetwork=1,InvalidInput=2,Paused=3,NotConfigured=4,
    StalePrice=5,OracleDeviation=6,LimitPrice=7,Overflow=8,
    InsufficientMargin=9,UnapprovedRisk=10,DuplicatePosition=11,
    PositionNotFound=12,PositionClosed=13,Insolvent=14,
    LossExceedsMargin=15,Expired=16,Capacity=17,UnauthorizedChange=18,
    InvalidFee=19,FundingOverdue=20,MaintenanceBreach=21,
    LiquidationNotRequired=22,InsuranceShortfall=23,PartialNotSafe=24,
    InvalidReduction=25,InvalidReward=26,InvalidKeeper=27,
}
fn admin(e:&Env)->Address {
    e.storage().instance().get(&Key::Admin).expect("constructor required")
}
fn collateral(e:&Env)->Address {
    e.storage().instance().get(&Key::Token).expect("constructor required")
}
fn totals(e:&Env)->Totals {
    e.storage().instance().get(&Key::Totals).expect("constructor required")
}
fn wallet(e:&Env,owner:&Address)->Wallet {
    e.storage().persistent().get(&Key::Wallet(owner.clone())).unwrap_or(Wallet{
        available_e7:0,locked_e7:0
    })
}
fn save_wallet(e:&Env,owner:&Address,w:&Wallet){
    let key=Key::Wallet(owner.clone());
    e.storage().persistent().set(&key,w);
    e.storage().persistent().extend_ttl(&key,TTL_THRESHOLD,TTL_TARGET);
}
fn save_position(e:&Env,p:&Position){
    let key=Key::Position(p.id.clone());
    e.storage().persistent().set(&key,p);
    e.storage().persistent().extend_ttl(&key,TTL_THRESHOLD,TTL_TARGET);
}
fn keep_instance(e:&Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
}
fn require_testnet(e:&Env)->Result<(),PerpError> {
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(PerpError::WrongNetwork)
    }else{Ok(())}
}
fn mul(a:i128,b:i128)->Result<i128,PerpError> {
    a.checked_mul(b).ok_or(PerpError::Overflow)
}
fn ceil(n:i128,d:i128)->Result<i128,PerpError> {
    if n<0||d<=0{return Err(PerpError::InvalidInput);}
    let q=n/d;
    if n%d==0{Ok(q)}else{q.checked_add(1).ok_or(PerpError::Overflow)}
}
fn notional(qty:i128,mark:i128)->Result<i128,PerpError>{
    if qty<=0||mark<=0{return Err(PerpError::InvalidInput);}
    let n=ceil(mul(qty,mark)?,SCALE)?;
    if n<=0||n>MAX_NOTIONAL_E7{return Err(PerpError::InvalidInput);}
    Ok(n)
}
fn margin(qty:i128,mark:i128)->Result<i128,PerpError> {
    ceil(mul(notional(qty,mark)?,INITIAL_MARGIN_BPS)?,BPS)
}
fn require_price(e:&Env)->Result<Price,PerpError>{
    let oracle:Address=e.storage().instance().get(&Key::Oracle).ok_or(PerpError::NotConfigured)?;
    let market:u32=e.storage().instance().get(&Key::Market).ok_or(PerpError::NotConfigured)?;
    let p=OracleClient::new(e,&oracle).current(&market);
    if p.mark_e7<=0||p.index_e7<=0{return Err(PerpError::InvalidInput);}
    let now=e.ledger().timestamp();
    if p.updated_at_sec>now||now-p.updated_at_sec>MAX_PRICE_AGE_SEC{
        return Err(PerpError::StalePrice);
    }
    let diff=p.mark_e7.checked_sub(p.index_e7).ok_or(PerpError::Overflow)?
        .checked_abs().ok_or(PerpError::Overflow)?;
    if mul(diff,BPS)?>mul(p.index_e7,MAX_DEVIATION_BPS)?{
        return Err(PerpError::OracleDeviation);
    }
    Ok(p)
}
fn require_solvency(e:&Env)->Result<(),PerpError>{
    if !m13::reconcile(e)?.solvent{return Err(PerpError::Insolvent);}
    Ok(())
}
#[contract]
pub struct PerpClearinghouse;
#[contractimpl]
impl PerpClearinghouse {
    pub fn __constructor(e:Env,owner:Address,token_addr:Address,market_id:u32){
        if require_testnet(&e).is_err(){panic!("Hoxo M12 requires Stellar Testnet");}
        owner.require_auth();
        if market_id==0||token::TokenClient::new(&e,&token_addr).decimals()!=7{
            panic!("invalid token or market");
        }
        e.storage().instance().set(&Key::Admin,&owner);
        e.storage().instance().set(&Key::Token,&token_addr);
        e.storage().instance().set(&Key::Market,&market_id);
        e.storage().instance().set(&Key::Paused,&true);
        e.storage().instance().set(&Key::Totals,&Totals{
            total_user_claims_e7:0,open_positions:0
        });
        m13::init(&e);
        m14::init(&e);
        keep_instance(&e);
    }
    pub fn market(e:Env)->MarketView{
        let t=totals(&e);
        let fee=m13::ledger(&e);
        let insurance=m14::insurance(&e);
        let paused:bool=e.storage().instance().get(&Key::Paused).unwrap_or(true);
        let oracle=e.storage().instance().has(&Key::Oracle);
        let risk=e.storage().instance().has(&Key::Risk);
        MarketView {
            market_id:e.storage().instance().get(&Key::Market).unwrap_or(0),
            collateral_token:collateral(&e),paused,
            oracle_configured:oracle,risk_configured:risk,
            entry_gate_configured:!paused&&oracle&&risk,
            initial_margin_bps:INITIAL_MARGIN_BPS as u32,
            maintenance_margin_bps:MAINT_MARGIN_BPS as u32,
            total_user_claims_e7:t.total_user_claims_e7,open_positions:t.open_positions,
            fee_bps:fee.fee_bps,accrued_fees_e7:fee.fees_accrued_e7,
            insurance_reserves_e7:insurance.reserves_e7,
            keeper_reward_bps:insurance.keeper_reward_bps,
        }
    }
    /// Immutable collateral asset of the separately held M12 escrow.
    pub fn collateral_asset(e:Env)->Address{collateral(&e)}
    /// M15 custody handoff must never treat open perp liabilities as
    /// free canonical margin. Exposes only actual stored open position count.
    pub fn active_positions(e:Env)->u32{totals(&e).open_positions}
    pub fn wallet(e:Env,owner:Address)->Wallet {wallet(&e,&owner)}
    pub fn reconciliation(e:Env)->Result<Reconciliation,PerpError>{
        require_testnet(&e)?;
        m13::reconcile(&e)
    }
    /// Fee governance is immutable while any positions are open. Starts at
    /// ZERO fees. No admin sweep of accumulated fee reserves in M13.
    pub fn set_fee_bps(e:Env,bps:u32)->Result<(),PerpError>{
        require_testnet(&e)?;
        admin(&e).require_auth();
        if bps>MAX_FEE_BPS||totals(&e).open_positions>0||
           !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(PerpError::InvalidFee);
        }
        let mut l=m13::ledger(&e);
        l.fee_bps=bps;
        m13::save(&e,&l);
        Ok(())
    }
    pub fn insurance_state(e:Env)->InsuranceState {m14::insurance(&e)}
    /// Funding is a direct, exact 7-decimal transfer into a separate
    /// insurance reserve: not user equity, not accrued trading fees.
    /// No withdrawal/sweep privilege exists in M14.
    pub fn fund_insurance(e:Env,funder:Address,amount_e7:i128)->Result<i128,PerpError>{
        require_testnet(&e)?;
        funder.require_auth();
        if amount_e7<=0||amount_e7>MAX_NOTIONAL_E7{return Err(PerpError::InvalidInput);}
        require_solvency(&e)?;
        let mut insurance=m14::insurance(&e);
        let next=insurance.reserves_e7.checked_add(amount_e7).ok_or(PerpError::Overflow)?;
        if next>MAX_NOTIONAL_E7{return Err(PerpError::InvalidInput);}
        let token=token::TokenClient::new(&e,&collateral(&e));
        let vault=e.current_contract_address();
        let before=token.balance(&vault);
        token.transfer(&funder,&vault,&amount_e7);
        let after=token.balance(&vault);
        if after.checked_sub(before)!=Some(amount_e7){return Err(PerpError::Insolvent);}
        insurance.reserves_e7=next;
        insurance.contributed_e7=insurance.contributed_e7.checked_add(amount_e7)
            .ok_or(PerpError::Overflow)?;
        m14::save(&e,&insurance);
        require_solvency(&e)?;
        Ok(next)
    }
    /// Bounded keeper reward (0–50bps) can only be configured while paused
    /// and with zero open positions. Defaults to zero.
    pub fn set_keeper_reward_bps(e:Env,bps:u32)->Result<(),PerpError>{
        require_testnet(&e)?;
        admin(&e).require_auth();
        if bps>MAX_REWARD_BPS||totals(&e).open_positions>0||
           !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(PerpError::InvalidReward);
        }
        let mut i=m14::insurance(&e);
        i.keeper_reward_bps=bps;
        m14::save(&e,&i);
        Ok(())
    }
    /// Read-only shortfall/maintenance quote, not a guaranteed liquidation.
    pub fn liquidation_preview(e:Env,id:BytesN<32>)->Result<LiquidationPreview,PerpError>{
        require_testnet(&e)?;
        let p:Position=e.storage().persistent().get(&Key::Position(id))
            .ok_or(PerpError::PositionNotFound)?;
        let oracle=require_price(&e)?;
        require_solvency(&e)?;
        m14::quote(&p,&oracle,e.ledger().timestamp(),&m14::insurance(&e))
    }
    pub fn position(e:Env,id:BytesN<32>)->Option<Position> {
        e.storage().persistent().get(&Key::Position(id))
    }
    /// Admin may bind oracle+risk ONCE while paused and no open positions.
    /// Audit and independently verify BOTH contracts before doing this.
    pub fn set_controllers(e:Env,oracle:Address,risk:Address)->Result<(),PerpError>{
        require_testnet(&e)?;
        admin(&e).require_auth();
        if oracle==risk||oracle==e.current_contract_address()||
           risk==e.current_contract_address()||
           e.storage().instance().has(&Key::Oracle)||
           e.storage().instance().has(&Key::Risk)||
           !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true)||
           totals(&e).open_positions>0{
            return Err(PerpError::UnauthorizedChange);
        }
        e.storage().instance().set(&Key::Oracle,&oracle);
        e.storage().instance().set(&Key::Risk,&risk);
        keep_instance(&e);
        Ok(())
    }
    pub fn set_pause(e:Env,paused:bool)->Result<(),PerpError>{
        require_testnet(&e)?;
        admin(&e).require_auth();
        if !paused&&(!e.storage().instance().has(&Key::Oracle)||
                     !e.storage().instance().has(&Key::Risk)){
            return Err(PerpError::NotConfigured);
        }
        e.storage().instance().set(&Key::Paused,&paused);
        keep_instance(&e);
        Ok(())
    }
    /// Deposit into ISOLATED clearinghouse margin, not M6 unified vault.
    pub fn deposit(e:Env,owner:Address,amount_e7:i128)->Result<i128,PerpError>{
        require_testnet(&e)?;
        owner.require_auth();
        if amount_e7<=0{return Err(PerpError::InvalidInput);}
        if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(PerpError::Paused);
        }
        require_solvency(&e)?;
        let mut w=wallet(&e,&owner);
        let total=totals(&e);
        let next_total=total.total_user_claims_e7.checked_add(amount_e7)
            .ok_or(PerpError::Overflow)?;
        let next_available=w.available_e7.checked_add(amount_e7)
            .ok_or(PerpError::Overflow)?;
        let tok=token::TokenClient::new(&e,&collateral(&e));
        let vault=e.current_contract_address();
        let before=tok.balance(&vault);
        tok.transfer(&owner,&vault,&amount_e7);
        let after=tok.balance(&vault);
        if after.checked_sub(before)!=Some(amount_e7)||after<next_total{
            return Err(PerpError::Insolvent);
        }
        w.available_e7=next_available;
        save_wallet(&e,&owner,&w);
        e.storage().instance().set(&Key::Totals,&Totals{
            total_user_claims_e7:next_total,..total
        });
        keep_instance(&e);
        Ok(w.available_e7)
    }
    /// User-controlled withdrawal of FREE margin; not blocked by admin pause.
    pub fn withdraw(e:Env,owner:Address,amount_e7:i128)->Result<i128,PerpError>{
        require_testnet(&e)?;
        owner.require_auth();
        if amount_e7<=0{return Err(PerpError::InvalidInput);}
        require_solvency(&e)?;
        let mut w=wallet(&e,&owner);
        if w.available_e7<amount_e7{return Err(PerpError::InsufficientMargin);}
        let t=totals(&e);
        let next_total=t.total_user_claims_e7.checked_sub(amount_e7)
            .ok_or(PerpError::Insolvent)?;
        w.available_e7-=amount_e7;
        save_wallet(&e,&owner,&w);
        e.storage().instance().set(&Key::Totals,&Totals{
            total_user_claims_e7:next_total,..t
        });
        let tok=token::TokenClient::new(&e,&collateral(&e));
        let vault=e.current_contract_address();
        let before=tok.balance(&vault);
        tok.transfer(&vault,&owner,&amount_e7);
        let after=tok.balance(&vault);
        if after.checked_add(amount_e7)!=Some(before)||after<next_total{
            return Err(PerpError::Insolvent);
        }
        keep_instance(&e);
        Ok(w.available_e7)
    }
    /// Bilateral opening with a genuine read of Soroban oracle/guard. In
    /// native tests controllers are MOCKS; NOT a live audited risk authority.
    pub fn open(
        e:Env,id:BytesN<32>,long:Address,short:Address,
        quantity_e7:i128,long_max_e7:i128,short_min_e7:i128,
        expires_at_ledger:u32
    )->Result<Position,PerpError>{
        require_testnet(&e)?;
        if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(PerpError::Paused);
        }
        if long==short||long_max_e7<=0||short_min_e7<=0{
            return Err(PerpError::InvalidInput);
        }
        let current_ledger=e.ledger().sequence();
        if expires_at_ledger<current_ledger||
            expires_at_ledger-current_ledger>100 {
            return Err(PerpError::Expired);
        }
        if e.storage().persistent().has(&Key::Position(id.clone())){
            return Err(PerpError::DuplicatePosition);
        }
        let mut t=totals(&e);
        if t.open_positions>=MAX_OPEN_POSITIONS{return Err(PerpError::Capacity);}
        let q=require_price(&e)?;
        if q.mark_e7>long_max_e7||q.mark_e7<short_min_e7{
            return Err(PerpError::LimitPrice);
        }
        let m=margin(quantity_e7,q.mark_e7)?;
        let mut f=m13::ledger(&e);
        let open_fee=m13::opening_or_closing_fee(quantity_e7,q.mark_e7,f.fee_bps)?;
        let required=m.checked_add(open_fee).ok_or(PerpError::Overflow)?;
        let mut wl=wallet(&e,&long);
        let mut ws=wallet(&e,&short);
        if wl.available_e7<required||ws.available_e7<required{
            return Err(PerpError::InsufficientMargin);
        }
        long.require_auth();
        short.require_auth();
        let risk:Address=e.storage().instance().get(&Key::Risk)
            .ok_or(PerpError::NotConfigured)?;
        let market:u32=e.storage().instance().get(&Key::Market)
            .ok_or(PerpError::NotConfigured)?;
        let clearinghouse=e.current_contract_address();
        if !MarginRiskClient::new(&e,&risk).approve_open(
            &long,&clearinghouse,&market,&quantity_e7,&m,&q.mark_e7
        )||!MarginRiskClient::new(&e,&risk).approve_open(
            &short,&clearinghouse,&market,&(-quantity_e7),&m,&q.mark_e7
        ){
            return Err(PerpError::UnapprovedRisk);
        }
        require_solvency(&e)?;
        wl.available_e7-=required;
        ws.available_e7-=required;
        let assessed=open_fee.checked_mul(2).ok_or(PerpError::Overflow)?;
        t.total_user_claims_e7=t.total_user_claims_e7.checked_sub(assessed)
            .ok_or(PerpError::Insolvent)?;
        f.fees_accrued_e7=f.fees_accrued_e7.checked_add(assessed)
            .ok_or(PerpError::Overflow)?;
        wl.locked_e7=wl.locked_e7.checked_add(m).ok_or(PerpError::Overflow)?;
        ws.locked_e7=ws.locked_e7.checked_add(m).ok_or(PerpError::Overflow)?;
        save_wallet(&e,&long,&wl);save_wallet(&e,&short,&ws);
        t.open_positions+=1;
        e.storage().instance().set(&Key::Totals,&t);
        m13::save(&e,&f);
        let pos=Position {
            id:id.clone(),long:long.clone(),short:short.clone(),
            base_quantity_e7:quantity_e7,entry_price_e7:q.mark_e7,
            initial_margin_each_e7:m,long_margin_e7:m,short_margin_e7:m,
            last_funding_sec:e.ledger().timestamp(),
            cumulative_funding_to_short_e7:0,total_fees_paid_e7:assessed,
            liquidated_quantity_e7:0,cumulative_realised_pnl_e7:0,liquidation_count:0,
            opened_at_sec:e.ledger().timestamp(),
            closed_at_sec:0,close_price_e7:0,long_realised_pnl_e7:0,
            active:true,
        };
        save_position(&e,&pos);
        keep_instance(&e);
        Opened{id,long,short,base_quantity_e7:quantity_e7,
            entry_price_e7:q.mark_e7,margin_each_e7:m}.publish(&e);
        Ok(pos)
    }
    /// Permissionless mark/index funding for at most one fresh 8h window.
    /// There are NO fabricated historical prices: stale funding fails shut.
    pub fn settle_funding(e:Env,id:BytesN<32>)->Result<i128,PerpError>{
        require_testnet(&e)?;
        let p:Position=e.storage().persistent().get(&Key::Position(id.clone()))
            .ok_or(PerpError::PositionNotFound)?;
        if !p.active{return Err(PerpError::PositionClosed);}
        let price=require_price(&e)?;
        require_solvency(&e)?;
        let (pos,wl,ws,paid)=m13::funding_step(&e,&p,&price)?;
        let mut f=m13::ledger(&e);
        f.cumulative_funding_to_short_e7=f.cumulative_funding_to_short_e7
            .checked_add(paid).ok_or(PerpError::Overflow)?;
        save_wallet(&e,&pos.long,&wl);
        save_wallet(&e,&pos.short,&ws);
        save_position(&e,&pos);
        m13::save(&e,&f);
        FundingSettled{id,long_pays_short_e7:paid,
            timestamp_sec:e.ledger().timestamp()}.publish(&e);
        Ok(paid)
    }
    /// Bilateral close at canonical oracle mark. Profits transfer between
    /// held margins; no new tokens created. Margin loss above escrow causes
    /// safe rejection until M14 liquidation/insurance architecture exists.
    /// Closing remains available during administrative trading pause.
    pub fn close(e:Env,id:BytesN<32>)->Result<Position,PerpError>{
        require_testnet(&e)?;
        let key=Key::Position(id.clone());
        let mut pos:Position=e.storage().persistent().get(&key)
            .ok_or(PerpError::PositionNotFound)?;
        if !pos.active{return Err(PerpError::PositionClosed);}
        pos.long.require_auth();pos.short.require_auth();
        let q=require_price(&e)?;
        require_solvency(&e)?;
        let (updated,mut wl,mut ws,paid)=m13::funding_step(&e,&pos,&q)?;
        pos=updated;
        let delta=q.mark_e7.checked_sub(pos.entry_price_e7)
            .ok_or(PerpError::Overflow)?;
        let pnl=mul(pos.base_quantity_e7,delta)?/SCALE;
        let lm=pos.long_margin_e7;
        let sm=pos.short_margin_e7;
        if wl.locked_e7<lm||ws.locked_e7<sm{return Err(PerpError::Insolvent);}
        let gross_long=lm.checked_add(pnl).ok_or(PerpError::Overflow)?;
        let gross_short=sm.checked_sub(pnl).ok_or(PerpError::Overflow)?;
        if gross_long<0||gross_short<0{return Err(PerpError::LossExceedsMargin);}
        let mut fee=m13::ledger(&e);
        let base_fee=m13::opening_or_closing_fee(
            pos.base_quantity_e7,q.mark_e7,fee.fee_bps
        )?;
        // If a losing side has no payout left, never create fee debt.
        let long_fee=base_fee.min(gross_long);
        let short_fee=base_fee.min(gross_short);
        let assessed=long_fee.checked_add(short_fee).ok_or(PerpError::Overflow)?;
        wl.locked_e7-=lm;ws.locked_e7-=sm;
        wl.available_e7=wl.available_e7.checked_add(gross_long-long_fee)
            .ok_or(PerpError::Overflow)?;
        ws.available_e7=ws.available_e7.checked_add(gross_short-short_fee)
            .ok_or(PerpError::Overflow)?;
        save_wallet(&e,&pos.long,&wl);save_wallet(&e,&pos.short,&ws);
        let mut t=totals(&e);
        t.open_positions=t.open_positions.checked_sub(1).ok_or(PerpError::Insolvent)?;
        t.total_user_claims_e7=t.total_user_claims_e7.checked_sub(assessed)
            .ok_or(PerpError::Insolvent)?;
        e.storage().instance().set(&Key::Totals,&t);
        fee.fees_accrued_e7=fee.fees_accrued_e7.checked_add(assessed)
            .ok_or(PerpError::Overflow)?;
        fee.cumulative_funding_to_short_e7=fee.cumulative_funding_to_short_e7
            .checked_add(paid).ok_or(PerpError::Overflow)?;
        m13::save(&e,&fee);
        pos.total_fees_paid_e7=pos.total_fees_paid_e7
            .checked_add(assessed).ok_or(PerpError::Overflow)?;
        pos.active=false;pos.close_price_e7=q.mark_e7;
        pos.closed_at_sec=e.ledger().timestamp();pos.long_realised_pnl_e7=pnl;
        pos.cumulative_realised_pnl_e7=pos.cumulative_realised_pnl_e7
            .checked_add(pnl).ok_or(PerpError::Overflow)?;
        save_position(&e,&pos);
        keep_instance(&e);
        Closed{id,close_price_e7:q.mark_e7,long_realised_pnl_e7:pnl,
            closed_at_sec:e.ledger().timestamp()}.publish(&e);
        Ok(pos)
    }

    /// Keeper-authorised full/partial liquidation of a MAINTENANCE-BREACHED
    /// matched position. No bilateral close signatures needed, but both
    /// counterparties have already agreed to the contract's liquidation rule
    /// at opening. Insolvent full close needs genuine PREFUNDED insurance.
    /// A gap >8h fails: M14 cannot invent historical oracle funding.
    pub fn liquidate(
        e:Env,id:BytesN<32>,keeper:Address,quantity_to_close_e7:i128
    )->Result<LiquidationResult,PerpError>{
        require_testnet(&e)?;
        keeper.require_auth();
        let p:Position=e.storage().persistent().get(&Key::Position(id.clone()))
            .ok_or(PerpError::PositionNotFound)?;
        if !p.active{return Err(PerpError::PositionClosed);}
        if keeper==p.long||keeper==p.short{return Err(PerpError::InvalidKeeper);}
        if quantity_to_close_e7<=0||quantity_to_close_e7>p.base_quantity_e7{
            return Err(PerpError::InvalidReduction);
        }
        let q=require_price(&e)?;
        require_solvency(&e)?;
        let mut insurance=m14::insurance(&e);
        let snapshot=m14::quote(&p,&q,e.ledger().timestamp(),&insurance)?;
        if !snapshot.required{return Err(PerpError::LiquidationNotRequired);}
        let mut wl=wallet(&e,&p.long);
        let mut ws=wallet(&e,&p.short);
        let mut wk=wallet(&e,&keeper);
        if wl.locked_e7<p.long_margin_e7||ws.locked_e7<p.short_margin_e7{
            return Err(PerpError::Insolvent);
        }
        let mut totals=totals(&e);
        let mut f=m13::ledger(&e);
        let result=if quantity_to_close_e7==p.base_quantity_e7 {
            if !snapshot.can_full_liquidate{return Err(PerpError::InsuranceShortfall);}
            let (next,lp,sp,draw,reward,pnl,funding)=m14::full(
                &p,&q,e.ledger().timestamp(),&insurance
            )?;
            wl.locked_e7-=p.long_margin_e7;
            ws.locked_e7-=p.short_margin_e7;
            wl.available_e7=wl.available_e7.checked_add(lp).ok_or(PerpError::Overflow)?;
            ws.available_e7=ws.available_e7.checked_add(sp).ok_or(PerpError::Overflow)?;
            wk.available_e7=wk.available_e7.checked_add(reward).ok_or(PerpError::Overflow)?;
            insurance.reserves_e7-=draw;
            insurance.used_e7=insurance.used_e7.checked_add(draw).ok_or(PerpError::Overflow)?;
            totals.total_user_claims_e7=totals.total_user_claims_e7
                .checked_add(draw).ok_or(PerpError::Overflow)?;
            totals.open_positions=totals.open_positions.checked_sub(1).ok_or(PerpError::Insolvent)?;
            f.cumulative_funding_to_short_e7=f.cumulative_funding_to_short_e7
                .checked_add(funding).ok_or(PerpError::Overflow)?;
            save_position(&e,&next);
            LiquidationResult {
                position_id:id.clone(),fully_closed:true,
                quantity_closed_e7:quantity_to_close_e7,remaining_base_e7:0,
                keeper_reward_e7:reward,insurance_used_e7:draw,
                uncovered_bad_debt_e7:0,realised_long_pnl_e7:pnl,
            }
        }else{
            let (next,reward,pnl,funding)=m14::partial(
                &p,&q,e.ledger().timestamp(),quantity_to_close_e7,
                insurance.keeper_reward_bps
            )?;
            wl.locked_e7=wl.locked_e7.checked_sub(p.long_margin_e7)
                .and_then(|v|v.checked_add(next.long_margin_e7)).ok_or(PerpError::Overflow)?;
            ws.locked_e7=ws.locked_e7.checked_sub(p.short_margin_e7)
                .and_then(|v|v.checked_add(next.short_margin_e7)).ok_or(PerpError::Overflow)?;
            wk.available_e7=wk.available_e7.checked_add(reward).ok_or(PerpError::Overflow)?;
            f.cumulative_funding_to_short_e7=f.cumulative_funding_to_short_e7
                .checked_add(funding).ok_or(PerpError::Overflow)?;
            save_position(&e,&next);
            LiquidationResult {
                position_id:id.clone(),fully_closed:false,
                quantity_closed_e7:quantity_to_close_e7,
                remaining_base_e7:next.base_quantity_e7,
                keeper_reward_e7:reward,insurance_used_e7:0,
                uncovered_bad_debt_e7:0,realised_long_pnl_e7:pnl,
            }
        };
        insurance.liquidations=insurance.liquidations.checked_add(1).ok_or(PerpError::Overflow)?;
        save_wallet(&e,&p.long,&wl);
        save_wallet(&e,&p.short,&ws);
        save_wallet(&e,&keeper,&wk);
        e.storage().instance().set(&Key::Totals,&totals);
        m13::save(&e,&f);
        m14::save(&e,&insurance);
        require_solvency(&e)?;
        Liquidated {
            id,keeper,quantity_closed_e7:result.quantity_closed_e7,
            fully_closed:result.fully_closed,insurance_used_e7:result.insurance_used_e7,
            keeper_reward_e7:result.keeper_reward_e7,
        }.publish(&e);
        Ok(result)
    }

    pub fn solvent(e:Env)->bool {require_solvency(&e).is_ok()}
    /// Keep instance, account, and matching position-ID record alive to
    /// prevent replay after archival. Contract operation requires a
    /// monitored keeper and state restoration before any public funding.
    pub fn keepalive(e:Env,long:Address,short:Address,id:BytesN<32>){
        for key in [Key::Wallet(long),Key::Wallet(short),Key::Position(id)] {
            if e.storage().persistent().has(&key){
                e.storage().persistent().extend_ttl(&key,TTL_THRESHOLD,TTL_TARGET);
            }
        }
        keep_instance(&e);
    }
}
#[cfg(test)]
mod tests;
