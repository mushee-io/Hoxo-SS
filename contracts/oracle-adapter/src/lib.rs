#![no_std]
//! Source-authenticated *candidate* Stellar Testnet oracle for ONE market.
//! Both publisher addresses are immutable, separately signed on-chain.
//! It never approves positions, credit, margin, asset custody or price source
//! independence: governance must approve external market data and audit it.
//! Its "current" ABI matches M12/M14's canonical oracle client, but this does
//! NOT make M12/M14 safe to activate. Their M7 risk controller is not ready.
use soroban_sdk::{contract,contracterror,contractimpl,contracttype,Address,BytesN,Env};
const TESTNET_ID:[u8;32]=[
    0xce,0xe0,0x30,0x2d,0x59,0x84,0x4d,0x32,
    0xbd,0xca,0x91,0x5c,0x82,0x03,0xdd,0x44,
    0xb3,0x3f,0xbb,0x7e,0xdc,0x19,0x05,0x1e,
    0xa3,0x7a,0xbe,0xdf,0x28,0xec,0xd4,0x72,
];
const MAX_PRICE_E7:i128=1_000_000_000_000_000_000;
const MAX_AGE_SEC:u64=120;
const MAX_SOURCE_DEVIATION_BPS:i128=150;
const MAX_MARK_INDEX_BPS:i128=200;
const BPS:i128=10_000;
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Price {
    pub mark_e7:i128,
    pub index_e7:i128,
    pub updated_at_sec:u64,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
struct Observation {
    mark_e7:i128,index_e7:i128,at:u64,ledger:u32,
}
#[contracttype]
#[derive(Clone)]
enum Key {
    Admin,Market,PublisherOne,PublisherTwo,Paused,SourceOne,SourceTwo,
}
#[contracterror]
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
#[repr(u32)]
pub enum OracleError {
    WrongNetwork=1,InvalidMarket=2,NotConfigured=3,
    Paused=4,Stale=5,Deviation=6,InvalidPrice=7,
    NotAuthorized=8,OutOfOrder=9,Overflow=10,
}
fn require_testnet(e:&Env)->Result<(),OracleError>{
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(OracleError::WrongNetwork)
    }else{Ok(())}
}
fn keepalive(e:&Env){e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);}
fn publisher_one(e:&Env)->Address{
    e.storage().instance().get(&Key::PublisherOne).expect("oracle constructor")
}
fn publisher_two(e:&Env)->Address{
    e.storage().instance().get(&Key::PublisherTwo).expect("oracle constructor")
}
fn validate_price(mark:i128,index:i128)->Result<(),OracleError>{
    if mark<=0||index<=0||mark>MAX_PRICE_E7||index>MAX_PRICE_E7{
        return Err(OracleError::InvalidPrice);
    }
    let diff=if mark>=index {mark-index}else{index-mark};
    if diff.checked_mul(BPS).ok_or(OracleError::Overflow)? >
       index.checked_mul(MAX_MARK_INDEX_BPS).ok_or(OracleError::Overflow)?{
        return Err(OracleError::Deviation);
    }
    Ok(())
}
fn report(e:&Env,key:Key,now:u64)->Result<Observation,OracleError>{
    let x:Observation=e.storage().instance().get(&key).ok_or(OracleError::NotConfigured)?;
    if x.at>now||now-x.at>MAX_AGE_SEC{return Err(OracleError::Stale);}
    validate_price(x.mark_e7,x.index_e7)?;
    Ok(x)
}
fn avg(a:i128,b:i128)->Result<i128,OracleError>{
    a.checked_add(b).ok_or(OracleError::Overflow).map(|v|v/2)
}
fn within(a:i128,b:i128,median:i128)->Result<bool,OracleError>{
    let diff=if a>=b{a-b}else{b-a};
    Ok(diff.checked_mul(BPS).ok_or(OracleError::Overflow)? <=
        median.checked_mul(MAX_SOURCE_DEVIATION_BPS).ok_or(OracleError::Overflow)?)
}
#[contract]
pub struct OracleAdapter;
#[contractimpl]
impl OracleAdapter {
    pub fn __constructor(e:Env,admin:Address,market_id:u32,publisher_a:Address,publisher_b:Address){
        if require_testnet(&e).is_err()||market_id==0||
            admin==publisher_a||admin==publisher_b||publisher_a==publisher_b{
            panic!("invalid Hoxo Testnet oracle governance/publishers");
        }
        admin.require_auth();
        e.storage().instance().set(&Key::Admin,&admin);
        e.storage().instance().set(&Key::Market,&market_id);
        e.storage().instance().set(&Key::PublisherOne,&publisher_a);
        e.storage().instance().set(&Key::PublisherTwo,&publisher_b);
        e.storage().instance().set(&Key::Paused,&true);
        keepalive(&e);
    }
    pub fn submit(e:Env,publisher:Address,market_id:u32,mark_e7:i128,index_e7:i128)
        ->Result<(),OracleError>{
        require_testnet(&e)?;
        if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(OracleError::Paused);
        }
        if e.storage().instance().get::<_,u32>(&Key::Market)!=Some(market_id)
            ||market_id==0{return Err(OracleError::InvalidMarket);}
        validate_price(mark_e7,index_e7)?;
        let source=if publisher==publisher_one(&e){Key::SourceOne}
            else if publisher==publisher_two(&e){Key::SourceTwo}
            else{return Err(OracleError::NotAuthorized);};
        publisher.require_auth();
        let now=e.ledger().timestamp();
        if let Some(previous)=e.storage().instance().get::<_,Observation>(&source){
            // Immutable, increasing ledger sequence prevents same-block source
            // rewriting, even if its publisher's signing key is compromised.
            if now<previous.at||e.ledger().sequence()<=previous.ledger{
                return Err(OracleError::OutOfOrder);
            }
        }
        e.storage().instance().set(&source,&Observation{
            mark_e7,index_e7,at:now,ledger:e.ledger().sequence()
        });
        keepalive(&e);
        Ok(())
    }
    pub fn current(e:Env,market_id:u32)->Result<Price,OracleError>{
        require_testnet(&e)?;
        if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(OracleError::Paused);
        }
        if e.storage().instance().get::<_,u32>(&Key::Market)!=Some(market_id)
            ||market_id==0{return Err(OracleError::InvalidMarket);}
        let now=e.ledger().timestamp();
        let a=report(&e,Key::SourceOne,now)?;
        let b=report(&e,Key::SourceTwo,now)?;
        let mark=avg(a.mark_e7,b.mark_e7)?;
        let index=avg(a.index_e7,b.index_e7)?;
        if !within(a.mark_e7,b.mark_e7,mark)?||
           !within(a.index_e7,b.index_e7,index)?{
            return Err(OracleError::Deviation);
        }
        validate_price(mark,index)?;
        Ok(Price{mark_e7:mark,index_e7:index,
            updated_at_sec:core::cmp::min(a.at,b.at)})
    }
    pub fn pause(e:Env,paused:bool)->Result<(),OracleError>{
        require_testnet(&e)?;
        let admin:Address=e.storage().instance().get(&Key::Admin)
            .ok_or(OracleError::NotConfigured)?;
        admin.require_auth();
        // Pausing always permitted. Unpause may allow new submissions, but
        // cannot conjure two fresh prices or release any trading guard.
        e.storage().instance().set(&Key::Paused,&paused);
        keepalive(&e);
        Ok(())
    }
    pub fn status(e:Env)->(bool,u32,bool,bool){
        (e.storage().instance().get(&Key::Paused).unwrap_or(true),
            e.storage().instance().get(&Key::Market).unwrap_or(0),
            e.storage().instance().has(&Key::SourceOne),
            e.storage().instance().has(&Key::SourceTwo))
    }
    /// Explicitly forbidden to treat two publisher signatures as approval of
    /// on-chain risk, fair price sourcing, production deployment or auditing.
    pub fn execution_approved()->bool{false}
}
#[cfg(test)]
mod tests;
