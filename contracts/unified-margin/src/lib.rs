#![no_std]
//! HOXO SS M15 — Testnet SINGLE-ASSET canonical margin/reservation ledger.
//! Spot, perpetual and lending roles reserve the SAME recorded user balance.
//! Never count a reservation twice. No lending principal is minted, no
//! leverage or cross-asset valuations are represented by this contract.
//! Existing M9/M11/M12 contracts do not share cross-product risk positions.
//! An optional Testnet-only custody router now atomically transfers FREE
//! tokens/claims between their isolated vaults; not shared leveraged margin.
//! Authorised adapters must be independently audited before activation.
//! M7's current preview-only risk gate returns false for enablement.
//! Starts PAUSED, with no risk authority and no adapters.
use soroban_sdk::{
    contract,contractclient,contracterror,contractevent,contractimpl,
    contracttype,token,Address,BytesN,Env,
};
const TESTNET_ID:[u8;32]=[
    0xce,0xe0,0x30,0x2d,0x59,0x84,0x4d,0x32,
    0xbd,0xca,0x91,0x5c,0x82,0x03,0xdd,0x44,
    0xb3,0x3f,0xbb,0x7e,0xdc,0x19,0x05,0x1e,
    0xa3,0x7a,0xbe,0xdf,0x28,0xec,0xd4,0x72,
];
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
const MAX_CLAIMS_E7:i128=10_000_000_000_000_000;
const MAX_RESERVATIONS:u32=100_000;
#[contracttype]
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum Product { Spot=1, Perp=2, Lending=3 }
impl Product {
    fn code(self)->u32{self as u32}
}
#[contractclient(name="MarginRiskClient")]
pub trait MarginRisk {
    /// A deployed, audited canonical on-chain risk authority must calculate
    /// all liabilities from authenticated state. Never trust client prices
    /// or off-chain M8 signatures as spending permissions.
    fn authorization_enabled(env:Env)->bool;
    fn approve_reservation(
        env:Env,owner:Address,vault:Address,asset:Address,
        product:u32,id:BytesN<32>,amount_e7:i128
    )->bool;
}
#[contracttype]
#[derive(Clone)]
pub enum Key {
    Admin, Asset, Paused, Risk, Adapter(Product), RoleEnabled(Product),
    Account(Address), Totals, Reservation(BytesN<32>),
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct Account {
    pub available_e7:i128,
    pub reserved_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct Totals {
    pub user_claims_e7:i128,
    pub active_reservations:u32,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct Reservation {
    pub id:BytesN<32>,
    pub owner:Address,
    pub adapter:Address,
    pub product:Product,
    pub initial_e7:i128,
    pub remaining_e7:i128,
    pub active:bool,
    pub created_ledger:u32,
}
#[contracttype]
#[derive(Clone,Debug,Eq,PartialEq)]
pub struct MarginView {
    pub collateral:Address,
    pub deposits_paused:bool,
    pub risk_configured:bool,
    pub risk_approved:bool,
    pub total_claims_e7:i128,
    pub active_reservations:u32,
}
#[contractevent(topics=["hoxo_margin","reserved"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Reserved {
    #[topic]
    pub id:BytesN<32>,
    pub owner:Address,
    pub product:Product,
    pub amount_e7:i128,
}
#[contractevent(topics=["hoxo_margin","released"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Released {
    #[topic]
    pub id:BytesN<32>,
    pub owner:Address,
    pub amount_e7:i128,
}
#[contractevent(topics=["hoxo_margin","settled"],data_format="vec")]
#[derive(Clone,Debug)]
pub struct Settled {
    #[topic]
    pub id:BytesN<32>,
    pub payer:Address,
    pub payee:Address,
    pub amount_e7:i128,
}
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum MarginError {
    WrongNetwork=1,InvalidAmount=2,Paused=3,NotConfigured=4,
    InsufficientFree=5,InsufficientReserved=6,Overflow=7,
    Insolvent=8,DuplicateReservation=9,InvalidReservation=10,
    UnapprovedAdapter=11,RiskDenied=12,UnauthorizedRoleChange=13,
    TooManyReservations=14,ZeroAmount=15,
}
fn verify_testnet(e:&Env)->Result<(),MarginError>{
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(MarginError::WrongNetwork)
    }else{Ok(())}
}
fn admin(e:&Env)->Address{
    e.storage().instance().get(&Key::Admin).expect("constructor required")
}
fn asset(e:&Env)->Address{
    e.storage().instance().get(&Key::Asset).expect("constructor required")
}
fn totals(e:&Env)->Totals{
    e.storage().instance().get(&Key::Totals).expect("constructor required")
}
fn account(e:&Env,owner:&Address)->Account {
    e.storage().persistent().get(&Key::Account(owner.clone()))
        .unwrap_or(Account{available_e7:0,reserved_e7:0})
}
fn save_account(e:&Env,owner:&Address,account:&Account){
    let k=Key::Account(owner.clone());
    e.storage().persistent().set(&k,account);
    e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
}
fn record(e:&Env,id:&BytesN<32>)->Option<Reservation>{
    e.storage().persistent().get(&Key::Reservation(id.clone()))
}
fn save_record(e:&Env,p:&Reservation){
    let k=Key::Reservation(p.id.clone());
    e.storage().persistent().set(&k,p);
    e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
}
fn keep_instance(e:&Env){
    e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
}
fn require_solvent(e:&Env)->Result<(),MarginError>{
    let claims=totals(e).user_claims_e7;
    if claims<0||token::TokenClient::new(e,&asset(e))
        .balance(&e.current_contract_address())<claims{
        return Err(MarginError::Insolvent);
    }
    Ok(())
}
fn gate_role(e:&Env,product:Product,adapter:&Address)->Result<Address,MarginError>{
    if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
        return Err(MarginError::Paused);
    }
    if !e.storage().instance().get::<_,bool>(&Key::RoleEnabled(product)).unwrap_or(false){
        return Err(MarginError::UnapprovedAdapter);
    }
    let registered:Address=e.storage().instance().get(&Key::Adapter(product))
        .ok_or(MarginError::NotConfigured)?;
    if registered!=*adapter{return Err(MarginError::UnapprovedAdapter);}
    let risk:Address=e.storage().instance().get(&Key::Risk)
        .ok_or(MarginError::NotConfigured)?;
    if !MarginRiskClient::new(e,&risk).authorization_enabled(){
        return Err(MarginError::RiskDenied);
    }
    Ok(risk)
}
fn active_record(e:&Env,id:&BytesN<32>,adapter:&Address)->Result<Reservation,MarginError>{
    let r=record(e,id).ok_or(MarginError::InvalidReservation)?;
    if !r.active||r.remaining_e7<=0||r.adapter!=*adapter{
        return Err(MarginError::InvalidReservation);
    }
    Ok(r)
}
fn decrease_active(t:&mut Totals)->Result<(),MarginError>{
    t.active_reservations=t.active_reservations.checked_sub(1)
        .ok_or(MarginError::Insolvent)?;
    Ok(())
}
#[contract]
pub struct UnifiedMargin;
#[contractimpl]
impl UnifiedMargin {
    pub fn __constructor(e:Env,owner:Address,token_address:Address){
        if verify_testnet(&e).is_err(){panic!("M15 only Stellar Testnet");}
        owner.require_auth();
        if token::TokenClient::new(&e,&token_address).decimals()!=7{
            panic!("M15 requires approved seven-decimal token");
        }
        e.storage().instance().set(&Key::Admin,&owner);
        e.storage().instance().set(&Key::Asset,&token_address);
        e.storage().instance().set(&Key::Paused,&true);
        e.storage().instance().set(&Key::Totals,&Totals{
            user_claims_e7:0,active_reservations:0
        });
        keep_instance(&e);
    }
    pub fn account(e:Env,owner:Address)->Account{account(&e,&owner)}
    /// M15's actual immutable collateral asset; used by risk contracts
    /// instead of trusting caller-supplied asset addresses.
    pub fn collateral_asset(e:Env)->Address{asset(&e)}
    pub fn reservation(e:Env,id:BytesN<32>)->Option<Reservation>{record(&e,&id)}
    pub fn totals(e:Env)->Totals{totals(&e)}
    pub fn margin(e:Env)->MarginView {
        let risk=e.storage().instance().get::<_,Address>(&Key::Risk);
        MarginView{
            collateral:asset(&e),
            deposits_paused:e.storage().instance().get(&Key::Paused).unwrap_or(true),
            risk_configured:risk.is_some(),
            risk_approved:risk.map(|a|MarginRiskClient::new(&e,&a).authorization_enabled())
                .unwrap_or(false),
            total_claims_e7:totals(&e).user_claims_e7,
            active_reservations:totals(&e).active_reservations,
        }
    }
    pub fn adapter(e:Env,product:Product)->Option<Address>{
        e.storage().instance().get(&Key::Adapter(product))
    }
    pub fn role_enabled(e:Env,product:Product)->bool{
        e.storage().instance().get(&Key::RoleEnabled(product)).unwrap_or(false)
    }
    pub fn set_risk(e:Env,risk:Address)->Result<(),MarginError>{
        verify_testnet(&e)?;
        admin(&e).require_auth();
        if e.storage().instance().has(&Key::Risk)||
           !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true)||
           totals(&e).active_reservations!=0||risk==e.current_contract_address(){
            return Err(MarginError::UnauthorizedRoleChange);
        }
        e.storage().instance().set(&Key::Risk,&risk);
        keep_instance(&e);
        Ok(())
    }
    pub fn bind_adapter(e:Env,product:Product,address:Address)->Result<(),MarginError>{
        verify_testnet(&e)?;
        admin(&e).require_auth();
        if !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true)||
           e.storage().instance().has(&Key::Adapter(product))||
           !e.storage().instance().has(&Key::Risk)||
           address==e.current_contract_address(){
            return Err(MarginError::UnauthorizedRoleChange);
        }
        e.storage().instance().set(&Key::Adapter(product),&address);
        e.storage().instance().set(&Key::RoleEnabled(product),&false);
        keep_instance(&e);
        Ok(())
    }
    pub fn enable_role(e:Env,product:Product,enabled:bool)->Result<(),MarginError>{
        verify_testnet(&e)?;
        admin(&e).require_auth();
        if !e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true)||
           !e.storage().instance().has(&Key::Adapter(product)){
            return Err(MarginError::UnauthorizedRoleChange);
        }
        if enabled{
            let risk:Address=e.storage().instance().get(&Key::Risk)
                .ok_or(MarginError::NotConfigured)?;
            if !MarginRiskClient::new(&e,&risk).authorization_enabled(){
                return Err(MarginError::RiskDenied);
            }
        }
        e.storage().instance().set(&Key::RoleEnabled(product),&enabled);
        keep_instance(&e);
        Ok(())
    }
    pub fn pause(e:Env,paused:bool)->Result<(),MarginError>{
        verify_testnet(&e)?;
        admin(&e).require_auth();
        if !paused{
            let risk:Address=e.storage().instance().get(&Key::Risk)
                .ok_or(MarginError::NotConfigured)?;
            if !MarginRiskClient::new(&e,&risk).authorization_enabled(){
                return Err(MarginError::RiskDenied);
            }
        }
        e.storage().instance().set(&Key::Paused,&paused);
        keep_instance(&e);
        Ok(())
    }
    /// Deposit escrow directly to canonical vault; no product adapter can
    /// mint synthetic assets or credit a balance without token receipt.
    pub fn deposit(e:Env,owner:Address,amount:i128)->Result<i128,MarginError>{
        verify_testnet(&e)?;
        owner.require_auth();
        if amount<=0{return Err(MarginError::InvalidAmount);}
        if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
            return Err(MarginError::Paused);
        }
        require_solvent(&e)?;
        let mut w=account(&e,&owner);
        let mut t=totals(&e);
        let next=w.available_e7.checked_add(amount).ok_or(MarginError::Overflow)?;
        let claims=t.user_claims_e7.checked_add(amount).ok_or(MarginError::Overflow)?;
        if claims>MAX_CLAIMS_E7{return Err(MarginError::Overflow);}
        let token=token::TokenClient::new(&e,&asset(&e));
        let vault=e.current_contract_address();
        let before=token.balance(&vault);
        token.transfer(&owner,&vault,&amount);
        let after=token.balance(&vault);
        if after.checked_sub(before)!=Some(amount)||after<claims{
            return Err(MarginError::Insolvent);
        }
        w.available_e7=next;
        t.user_claims_e7=claims;
        save_account(&e,&owner,&w);
        e.storage().instance().set(&Key::Totals,&t);
        keep_instance(&e);
        Ok(next)
    }
    /// No adapter, admin or risk authority can block withdrawals of FREE
    /// balance during pause. Reserved collateral cannot be withdrawn.
    pub fn withdraw(e:Env,owner:Address,amount:i128)->Result<i128,MarginError>{
        verify_testnet(&e)?;
        owner.require_auth();
        if amount<=0{return Err(MarginError::InvalidAmount);}
        require_solvent(&e)?;
        let mut w=account(&e,&owner);
        if w.available_e7<amount{return Err(MarginError::InsufficientFree);}
        let mut t=totals(&e);
        t.user_claims_e7=t.user_claims_e7.checked_sub(amount)
            .ok_or(MarginError::Insolvent)?;
        w.available_e7-=amount;
        save_account(&e,&owner,&w);
        e.storage().instance().set(&Key::Totals,&t);
        let token=token::TokenClient::new(&e,&asset(&e));
        let vault=e.current_contract_address();
        let before=token.balance(&vault);
        token.transfer(&vault,&owner,&amount);
        let after=token.balance(&vault);
        if after.checked_add(amount)!=Some(before)||after<t.user_claims_e7{
            return Err(MarginError::Insolvent);
        }
        keep_instance(&e);
        Ok(w.available_e7)
    }
    /// Require owner AND approved role-adapter authorisation for a unique
    /// reservation; external risk approval derives its OWN canonical state.
    pub fn reserve(
        e:Env,owner:Address,adapter:Address,product:Product,
        id:BytesN<32>,amount:i128
    )->Result<i128,MarginError>{
        verify_testnet(&e)?;
        owner.require_auth();
        adapter.require_auth();
        if amount<=0{return Err(MarginError::InvalidAmount);}
        let risk=gate_role(&e,product,&adapter)?;
        if record(&e,&id).is_some(){return Err(MarginError::DuplicateReservation);}
        let mut t=totals(&e);
        if t.active_reservations>=MAX_RESERVATIONS{return Err(MarginError::TooManyReservations);}
        let mut w=account(&e,&owner);
        if w.available_e7<amount{return Err(MarginError::InsufficientFree);}
        require_solvent(&e)?;
        if !MarginRiskClient::new(&e,&risk).approve_reservation(
            &owner,&e.current_contract_address(),&asset(&e),&product.code(),&id,&amount
        ){
            return Err(MarginError::RiskDenied);
        }
        w.available_e7-=amount;
        w.reserved_e7=w.reserved_e7.checked_add(amount).ok_or(MarginError::Overflow)?;
        t.active_reservations+=1;
        let p=Reservation{
            id:id.clone(),owner:owner.clone(),adapter,product,
            initial_e7:amount,remaining_e7:amount,
            active:true,created_ledger:e.ledger().sequence(),
        };
        save_account(&e,&owner,&w);
        save_record(&e,&p);
        e.storage().instance().set(&Key::Totals,&t);
        keep_instance(&e);
        Reserved{id,owner,product,amount_e7:amount}.publish(&e);
        Ok(w.available_e7)
    }
    /// Adapter-mediated cancellation/partial release. Never allow owner to
    /// release its own locked perp liabilities without adapter agreement.
    /// Release remains possible during pause, enabling safe unwind.
    pub fn release(
        e:Env,id:BytesN<32>,adapter:Address,amount:i128
    )->Result<i128,MarginError>{
        verify_testnet(&e)?;
        adapter.require_auth();
        if amount<=0{return Err(MarginError::InvalidAmount);}
        let mut p=active_record(&e,&id,&adapter)?;
        if amount>p.remaining_e7{return Err(MarginError::InsufficientReserved);}
        let mut w=account(&e,&p.owner);
        if w.reserved_e7<amount{return Err(MarginError::Insolvent);}
        w.reserved_e7-=amount;
        w.available_e7=w.available_e7.checked_add(amount).ok_or(MarginError::Overflow)?;
        p.remaining_e7-=amount;
        let mut t=totals(&e);
        if p.remaining_e7==0{
            p.active=false;
            decrease_active(&mut t)?;
        }
        save_account(&e,&p.owner,&w);
        save_record(&e,&p);
        e.storage().instance().set(&Key::Totals,&t);
        keep_instance(&e);
        Released{id,owner:p.owner,amount_e7:amount}.publish(&e);
        Ok(p.remaining_e7)
    }
    /// Approved adapter moves ONLY funds previously reserved with both
    /// owner's and adapter's prior signatures. Zero mint, zero asset movement:
    /// an internal atomic transfer of user claims (spot DvP/perp funding/
    /// lending reservation accounting requires actual product adapter code).
    /// Current M9/M11/M12 contracts DO NOT invoke this method.
    pub fn settle_reserved(
        e:Env,id:BytesN<32>,adapter:Address,
        recipient:Address,amount:i128
    )->Result<i128,MarginError>{
        verify_testnet(&e)?;
        adapter.require_auth();
        if amount<=0{return Err(MarginError::InvalidAmount);}
        let mut p=active_record(&e,&id,&adapter)?;
        if amount>p.remaining_e7{return Err(MarginError::InsufficientReserved);}
        require_solvent(&e)?;
        let mut payer=account(&e,&p.owner);
        if payer.reserved_e7<amount{return Err(MarginError::Insolvent);}
        let mut t=totals(&e);
        p.remaining_e7-=amount;
        if p.remaining_e7==0{
            p.active=false;
            decrease_active(&mut t)?;
        }
        payer.reserved_e7-=amount;
        if recipient==p.owner{
            payer.available_e7=payer.available_e7.checked_add(amount)
                .ok_or(MarginError::Overflow)?;
            save_account(&e,&p.owner,&payer);
        }else{
            let mut payee=account(&e,&recipient);
            payee.available_e7=payee.available_e7.checked_add(amount)
                .ok_or(MarginError::Overflow)?;
            save_account(&e,&p.owner,&payer);
            save_account(&e,&recipient,&payee);
        }
        save_record(&e,&p);
        e.storage().instance().set(&Key::Totals,&t);
        keep_instance(&e);
        Settled{id,payer:p.owner,payee:recipient,amount_e7:amount}.publish(&e);
        Ok(p.remaining_e7)
    }
    pub fn solvent(e:Env)->bool{require_solvent(&e).is_ok()}
    /// Permissionless TTL keeper. Archived balances and reservation tombstones
    /// need explicit restore; no public deposits before keeper runbook/audit.
    pub fn keepalive(e:Env,owner:Address,id:BytesN<32>){
        for k in [Key::Account(owner),Key::Reservation(id)]{
            if e.storage().persistent().has(&k){
                e.storage().persistent().extend_ttl(&k,TTL_THRESHOLD,TTL_TARGET);
            }
        }
        keep_instance(&e);
    }
}
#[cfg(test)]
mod tests;
