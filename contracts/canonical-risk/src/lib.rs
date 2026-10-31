#![no_std]
//! Stellar Testnet on-chain READ of M15's actual collateral ledger.
//! Scope: EXACT owner-signed spot collateral reservation only.
//! This does NOT support leverage, swaps/DvP, lending, perpetuals, funding,
//! liquidation, cross-asset pricing or product escrow integration.
//! NEVER treat authorization_enabled() as approval for those other products.
//! Operator must review/audit all roles, oracle data and cross-contract calls.
use soroban_sdk::{
    contract,contractclient,contracterror,contractimpl,contracttype,
    token,Address,BytesN,Env,
};
const TESTNET_ID:[u8;32]=[
    0xce,0xe0,0x30,0x2d,0x59,0x84,0x4d,0x32,
    0xbd,0xca,0x91,0x5c,0x82,0x03,0xdd,0x44,
    0xb3,0x3f,0xbb,0x7e,0xdc,0x19,0x05,0x1e,
    0xa3,0x7a,0xbe,0xdf,0x28,0xec,0xd4,0x72,
];
const MAX_AGE_SEC:u64=120;
const MAX_MARK_INDEX_DEVIATION_BPS:i128=200;
const BPS:i128=10_000;
const SCALE:i128=10_000_000;
const MAX_OWNER_RESERVATION:i128=100_000*SCALE;
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct MarginAccount{
    pub available_e7:i128,
    pub reserved_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct MarginTotals{
    pub user_claims_e7:i128,
    pub active_reservations:u32,
}
#[contractclient(name="MarginLedgerClient")]
pub trait MarginLedger{
    fn account(env:Env,owner:Address)->MarginAccount;
    fn totals(env:Env)->MarginTotals;
    fn collateral_asset(env:Env)->Address;
    fn solvent(env:Env)->bool;
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Price{
    pub mark_e7:i128,
    pub index_e7:i128,
    pub updated_at_sec:u64,
}
#[contractclient(name="PriceOracleClient")]
pub trait PriceOracle{
    fn current(env:Env,market_id:u32)->Price;
}
#[contracttype]
#[derive(Clone)]
enum Key{Admin,Vault,Asset,Oracle,Market,Paused,MaxReservation,Pending(Address)}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct ReservationPermit{
    pub id:BytesN<32>,
    pub amount_e7:i128,
    pub product:u32,
    pub expires_at_ledger:u32,
}
#[contracttype]
#[derive(Clone,Debug)]
pub struct Status{
    pub paused:bool,
    pub max_owner_reserved_e7:i128,
    pub spot_only:bool,
    pub cross_product_margin_active:bool,
    pub borrowing_allowed:bool,
    pub perps_allowed:bool,
}
#[contracterror]
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum GuardError{
    WrongNetwork=1,InvalidInput=2,NotConfigured=3,Unauthorized=4,
}
fn testnet(e:&Env)->bool{
    e.ledger().network_id()==BytesN::from_array(e,&TESTNET_ID)
}
fn admin(e:&Env)->Address{
    e.storage().instance().get(&Key::Admin).expect("risk constructor")
}
fn keep_instance(e:&Env){
    e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
}
fn approved(e:&Env)->bool{
    testnet(e)&&!e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true)
}
/// Oracle may be read from a nested call because it does not call M15.
/// The margin vault itself must ONLY be read at the separate preflight step.
fn live_price(e:&Env)->bool{
    let oracle:Address=e.storage().instance().get(&Key::Oracle).unwrap();
    let market:u32=e.storage().instance().get(&Key::Market).unwrap_or(0);
    let p=PriceOracleClient::new(e,&oracle).current(&market);
    if p.mark_e7<=0||p.index_e7<=0{return false;}
    let now=e.ledger().timestamp();
    if now<p.updated_at_sec||now-p.updated_at_sec>MAX_AGE_SEC{return false;}
    let diff=match p.mark_e7.checked_sub(p.index_e7).and_then(|x|x.checked_abs()){
        Some(v)=>v,None=>return false,
    };
    let lhs=match diff.checked_mul(BPS){Some(v)=>v,None=>return false};
    let rhs=match p.index_e7.checked_mul(MAX_MARK_INDEX_DEVIATION_BPS){
        Some(v)=>v,None=>return false,
    };
    lhs<=rhs
}
#[contract]
pub struct CanonicalRisk;
#[contractimpl]
impl CanonicalRisk{
    pub fn __constructor(
        e:Env,admin:Address,vault:Address,asset:Address,
        oracle:Address,market_id:u32,max_owner_reserved_e7:i128
    ){
        if !testnet(&e)||market_id==0||vault==oracle||asset==vault||
            asset==oracle||admin==vault||admin==oracle||
            max_owner_reserved_e7<=0||max_owner_reserved_e7>MAX_OWNER_RESERVATION{
            panic!("invalid Hoxo Testnet spot-risk configuration");
        }
        admin.require_auth();
        // M15 must itself confirm token identity. No human-supplied fake
        // account balance/price/debt can be used to justify a reservation.
        let c=MarginLedgerClient::new(&e,&vault);
        if c.collateral_asset()!=asset||!c.solvent()||
            token::TokenClient::new(&e,&asset).decimals()!=7{
            panic!("M15 collateral is not genuine backed seven-decimal token");
        }
        e.storage().instance().set(&Key::Admin,&admin);
        e.storage().instance().set(&Key::Vault,&vault);
        e.storage().instance().set(&Key::Asset,&asset);
        e.storage().instance().set(&Key::Oracle,&oracle);
        e.storage().instance().set(&Key::Market,&market_id);
        e.storage().instance().set(&Key::MaxReservation,&max_owner_reserved_e7);
        e.storage().instance().set(&Key::Paused,&true);
        keep_instance(&e);
    }
    /// M15's existing global readiness ABI. TRUE means ONLY spot reservation
    /// may be reviewed in approve_reservation; it never approves other roles.
    pub fn authorization_enabled(e:Env)->bool{approved(&e)}
    pub fn status(e:Env)->Status{
        Status{
            paused:e.storage().instance().get(&Key::Paused).unwrap_or(true),
            max_owner_reserved_e7:e.storage().instance()
                .get(&Key::MaxReservation).unwrap_or(0),
            spot_only:true,
            cross_product_margin_active:false,
            borrowing_allowed:false,
            perps_allowed:false,
        }
    }
    pub fn pause(e:Env,paused:bool)->Result<(),GuardError>{
        if !testnet(&e){return Err(GuardError::WrongNetwork);}
        admin(&e).require_auth();
        e.storage().instance().set(&Key::Paused,&paused);
        keep_instance(&e);
        Ok(())
    }
    /// Step 1: owner signs an exact once-only spot reservation permit.
    /// This is the ONLY path to read M15's actual account/solvency. The
    /// main M15.reserve invocation is not active, so no Soroban re-entry.
    pub fn prepare_spot_reservation(
        e:Env,owner:Address,id:BytesN<32>,amount_e7:i128
    )->bool{
        if !approved(&e)||amount_e7<=0{return false;}
        owner.require_auth();
        let max:i128=e.storage().instance().get(&Key::MaxReservation).unwrap_or(0);
        if amount_e7>max{return false;}
        let key=Key::Pending(owner.clone());
        if let Some(old)=e.storage().persistent().get::<_,ReservationPermit>(&key){
            if old.expires_at_ledger>=e.ledger().sequence(){return false;}
        }
        let vault:Address=e.storage().instance().get(&Key::Vault).unwrap();
        let asset:Address=e.storage().instance().get(&Key::Asset).unwrap();
        let ledger=MarginLedgerClient::new(&e,&vault);
        if ledger.collateral_asset()!=asset||!ledger.solvent(){return false;}
        let account=ledger.account(&owner);
        if account.available_e7<amount_e7||account.available_e7<0||account.reserved_e7<0{
            return false;
        }
        if account.reserved_e7.checked_add(amount_e7).map(|v|v>max)!=Some(false){
            return false;
        }
        let totals=ledger.totals();
        let held=token::TokenClient::new(&e,&asset).balance(&vault);
        if held<totals.user_claims_e7||totals.user_claims_e7<=0{return false;}
        if !live_price(&e){return false;}
        let expiry=match e.ledger().sequence().checked_add(20){
            Some(v)=>v,None=>return false,
        };
        e.storage().persistent().set(&key,&ReservationPermit{
            id,amount_e7,product:1,expires_at_ledger:expiry
        });
        e.storage().persistent().extend_ttl(&key,100,1000);
        keep_instance(&e);
        true
    }
    pub fn pending(e:Env,owner:Address)->Option<ReservationPermit>{
        e.storage().persistent().get(&Key::Pending(owner))
    }
    pub fn cancel_spot_reservation(e:Env,owner:Address)->bool{
        if !testnet(&e){return false;}
        owner.require_auth();
        e.storage().persistent().remove(&Key::Pending(owner));
        true
    }
    /// Step 2: M15 has already checked actual free balance, vault solvency,
    /// exact owner+adapter auth and replay ID. Consume the exact permit
    /// without calling BACK into executing M15 (forbidden Soroban re-entry).
    pub fn approve_reservation(
        e:Env,owner:Address,vault:Address,asset:Address,
        product:u32,id:BytesN<32>,amount_e7:i128
    )->bool{
        if !approved(&e)||product!=1||amount_e7<=0||
           e.storage().instance().get::<_,Address>(&Key::Vault)!=Some(vault)||
           e.storage().instance().get::<_,Address>(&Key::Asset)!=Some(asset){
            return false;
        }
        owner.require_auth();
        let key=Key::Pending(owner);
        let permit=match e.storage().persistent().get::<_,ReservationPermit>(&key){
            Some(x)=>x,None=>return false,
        };
        if permit.id!=id||permit.product!=1||permit.amount_e7!=amount_e7||
           e.ledger().sequence()>permit.expires_at_ledger||!live_price(&e){
            return false;
        }
        // If the parent M15 reserve fails, Soroban atomically rolls back this
        // permit removal; it cannot mint collateral or bypass M15 controls.
        e.storage().persistent().remove(&key);
        true
    }
    /// ABI matches M11. Until unified credit and debt accounting is audited,
    /// a collateral spot reservation MUST NEVER underwrite a separate loan.
    pub fn approve_borrow(
        _e:Env,_borrower:Address,_market:Address,_asset:Address,
        _proposed_amount_e7:i128,_projected_debt_e7:i128
    )->bool{false}
    /// ABI matches M12. Independent perp escrow is NOT shared M15 collateral.
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,_market_id:u32,
        _proposed_signed_base_e7:i128,_requested_margin_e7:i128,_mark_e7:i128
    )->bool{false}
}
#[cfg(test)]
mod tests;
