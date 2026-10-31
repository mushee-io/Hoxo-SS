#![no_std]
//! HOXO SS M9 — isolated bilateral spot delivery versus payment (DvP).
//!
//! BOTH maker and taker must authorise exactly the same Soroban invocation.
//! The matched M8 off-chain intent alone NEVER gives custody/spending rights.
//! M6 vault and M7 unified margin are deliberately NOT integrated here.
//!
//! Only approved 7-decimal tokens, bounded amounts/prices, unique match IDs,
//! dual-sided limit checks, fresh ledger deadline, and exact token delivery.
//! No contract admin has a withdrawal/sweep capability.
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    token, Address, BytesN, Env,
};

const SCALE:i128=10_000_000;
const MAX_AMOUNT:i128=1_000_000_000_000_000; // 100m assets at 7 decimals
const MAX_PRICE_E7:i128=10_000_000_000_000_000; // 1b quote/base at 7 decimals
const MAX_EXPIRY_LEDGERS:u32=100;
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;

#[contracttype]
#[derive(Clone, Debug)]
pub struct MatchTerms {
    // Settlement-specific unique 32-byte ID; MUST bind to exact matched orders
    // in a later audited M8 bridge and wallet signing UI.
    pub match_id:BytesN<32>,
    pub maker_order_id:BytesN<32>,
    pub taker_order_id:BytesN<32>,
    pub maker:Address,
    pub taker:Address,
    pub base_token:Address,
    pub quote_token:Address,
    pub base_amount:i128, // token smallest units (both assets exactly 7 decimals)
    pub quote_amount:i128,
    pub maker_side:u32, // 0 = maker sells base; 1 = maker buys base
    pub maker_limit_e7:i128, // quote units per base unit, with 7 decimals
    pub taker_limit_e7:i128,
    pub expires_at_ledger:u32,
}
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementReceipt {
    pub match_id:BytesN<32>,
    pub maker_order_id:BytesN<32>,
    pub taker_order_id:BytesN<32>,
    pub maker:Address,
    pub taker:Address,
    pub base_token:Address,
    pub quote_token:Address,
    pub base_amount:i128,
    pub quote_amount:i128,
    pub maker_side:u32,
    pub settled_ledger:u32,
}
#[contractevent(topics = ["hoxo_spot", "settled"], data_format = "single-value")]
#[derive(Clone, Debug)]
pub struct SpotSettled {
    #[topic]
    pub match_id:BytesN<32>,
    pub maker:Address,
    pub taker:Address,
    pub base_token:Address,
    pub quote_token:Address,
    pub base_amount:i128,
    pub quote_amount:i128,
    pub settled_ledger:u32,
}

#[contracttype]
#[derive(Clone)]
pub enum Key {
    Admin,
    Paused,
    Allowed(Address),
    Settled(BytesN<32>),
}
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SettlementError {
    InvalidParticipants=1,
    InvalidAssets=2,
    UnapprovedToken=3,
    InvalidAmount=4,
    InvalidPrice=5,
    PriceLimit=6,
    Expired=7,
    InvalidDeadline=8,
    AlreadySettled=9,
    BalanceMismatch=10,
    Overflow=11,
    Paused=12,
    InvalidOrderIds=13,
}
fn admin(e:&Env)->Address {
    e.storage().instance().get(&Key::Admin).expect("constructor required")
}
fn keep_instance(e:&Env) {
    e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
}
fn allowed(e:&Env,token_addr:&Address)->bool {
    e.storage().persistent().get(&Key::Allowed(token_addr.clone())).unwrap_or(false)
}
fn token_client<'a>(e:&'a Env,addr:&Address)->token::TokenClient<'a> {
    token::TokenClient::new(e,addr)
}
fn checked_price(terms:&MatchTerms)->Result<(),SettlementError> {
    if terms.base_amount<=0 || terms.quote_amount<=0 ||
       terms.base_amount>MAX_AMOUNT || terms.quote_amount>MAX_AMOUNT {
        return Err(SettlementError::InvalidAmount);
    }
    if terms.maker_limit_e7<=0 || terms.taker_limit_e7<=0 ||
       terms.maker_limit_e7>MAX_PRICE_E7 || terms.taker_limit_e7>MAX_PRICE_E7 ||
       terms.maker_side>1 {
        return Err(SettlementError::InvalidPrice);
    }
    // Compare integer cross-products, not a rounded floating-point quote.
    let effective_quote=terms.quote_amount.checked_mul(SCALE).ok_or(SettlementError::Overflow)?;
    let maker_limit=terms.base_amount.checked_mul(terms.maker_limit_e7).ok_or(SettlementError::Overflow)?;
    let taker_limit=terms.base_amount.checked_mul(terms.taker_limit_e7).ok_or(SettlementError::Overflow)?;
    if terms.maker_side==0 {
        // Maker SELLS base; taker BUYS. Maker receives >= minimum,
        // taker spends <= maximum.
        if effective_quote<maker_limit || effective_quote>taker_limit {
            return Err(SettlementError::PriceLimit);
        }
    } else {
        // Maker BUYS base; taker SELLS. Maker spends <= maximum,
        // taker receives >= minimum.
        if effective_quote>maker_limit || effective_quote<taker_limit {
            return Err(SettlementError::PriceLimit);
        }
    }
    Ok(())
}
fn assert_change(before:i128,after:i128,delta:i128,increase:bool)->Result<(),SettlementError>{
    let expected=if increase {before.checked_add(delta)} else {before.checked_sub(delta)};
    if expected!=Some(after){return Err(SettlementError::BalanceMismatch);}
    Ok(())
}
fn pay_exact(
    e:&Env,token_addr:&Address,from:&Address,to:&Address,amount:i128
)->Result<(),SettlementError>{
    let token=token_client(e,token_addr);
    let from_before=token.balance(from);
    let to_before=token.balance(to);
    if from_before<amount {return Err(SettlementError::BalanceMismatch);}
    token.transfer(from,to,&amount);
    let from_after=token.balance(from);
    let to_after=token.balance(to);
    // Reject fee-on-transfer or otherwise nonconforming tokens.
    assert_change(from_before,from_after,amount,false)?;
    assert_change(to_before,to_after,amount,true)?;
    Ok(())
}
#[contract]
pub struct SpotSettlement;
#[contractimpl]
impl SpotSettlement {
    pub fn __constructor(e:Env,owner:Address) {
        owner.require_auth();
        e.storage().instance().set(&Key::Admin,&owner);
        e.storage().instance().set(&Key::Paused,&true); // fail closed by default
        keep_instance(&e);
    }
    pub fn admin(e:Env)->Address {admin(&e)}
    pub fn paused(e:Env)->bool {
        e.storage().instance().get(&Key::Paused).unwrap_or(true)
    }
    pub fn allowed(e:Env,asset:Address)->bool {allowed(&e,&asset)}
    pub fn set_asset(e:Env,asset:Address,enabled:bool)->Result<(),SettlementError> {
        admin(&e).require_auth();
        if enabled && token_client(&e,&asset).decimals()!=7 {
            return Err(SettlementError::InvalidAssets);
        }
        let key=Key::Allowed(asset);
        e.storage().persistent().set(&key,&enabled);
        e.storage().persistent().extend_ttl(&key,TTL_THRESHOLD,TTL_TARGET);
        keep_instance(&e);
        Ok(())
    }
    pub fn set_pause(e:Env,pause:bool) {
        admin(&e).require_auth();
        e.storage().instance().set(&Key::Paused,&pause);
        keep_instance(&e);
    }
    pub fn change_admin(e:Env,next:Address) {
        admin(&e).require_auth();
        next.require_auth();
        e.storage().instance().set(&Key::Admin,&next);
        keep_instance(&e);
    }
    pub fn quote_valid(terms:MatchTerms)->Result<(),SettlementError> {
        checked_price(&terms)
    }
    pub fn is_settled(e:Env,match_id:BytesN<32>)->bool {
        e.storage().persistent().has(&Key::Settled(match_id))
    }
    pub fn receipt(e:Env,match_id:BytesN<32>)->Option<SettlementReceipt> {
        e.storage().persistent().get(&Key::Settled(match_id))
    }
    // Permissionless TTL extension for live entries; archived records need
    // Stellar state restoration and must NOT be recreated with a new value.
    pub fn keepalive(e:Env,match_id:BytesN<32>,base_token:Address,quote_token:Address){
        let receipt_key=Key::Settled(match_id);
        let base_key=Key::Allowed(base_token);
        let quote_key=Key::Allowed(quote_token);
        for key in [receipt_key,base_key,quote_key] {
            if e.storage().persistent().has(&key) {
                e.storage().persistent().extend_ttl(&key,TTL_THRESHOLD,TTL_TARGET);
            }
        }
        keep_instance(&e);
    }
    pub fn settle(e:Env,terms:MatchTerms)->Result<SettlementReceipt,SettlementError> {
        if Self::paused(e.clone()){return Err(SettlementError::Paused);}
        if terms.maker==terms.taker{return Err(SettlementError::InvalidParticipants);}
        if terms.base_token==terms.quote_token{return Err(SettlementError::InvalidAssets);}
        if terms.maker_order_id==terms.taker_order_id{
            return Err(SettlementError::InvalidOrderIds);
        }
        let now=e.ledger().sequence();
        if terms.expires_at_ledger<now{return Err(SettlementError::Expired);}
        if terms.expires_at_ledger.checked_sub(now).unwrap_or(u32::MAX)>MAX_EXPIRY_LEDGERS {
            return Err(SettlementError::InvalidDeadline);
        }
        checked_price(&terms)?;
        if !allowed(&e,&terms.base_token)||!allowed(&e,&terms.quote_token){
            return Err(SettlementError::UnapprovedToken);
        }
        // Deny subtle relist mismatches if token decimals have since changed.
        if token_client(&e,&terms.base_token).decimals()!=7 ||
           token_client(&e,&terms.quote_token).decimals()!=7 {
            return Err(SettlementError::InvalidAssets);
        }
        let receipt_key=Key::Settled(terms.match_id.clone());
        if e.storage().persistent().has(&receipt_key) {
            return Err(SettlementError::AlreadySettled);
        }
        // Both parties must sign the SAME root Soroban settlement invocation;
        // an M8 off-chain order signature is explicitly insufficient.
        terms.maker.require_auth();
        terms.taker.require_auth();
        let (base_from,base_to,quote_from,quote_to)=if terms.maker_side==0 {
            (&terms.maker,&terms.taker,&terms.taker,&terms.maker)
        }else{
            (&terms.taker,&terms.maker,&terms.maker,&terms.taker)
        };
        // Cross-contract operations and storage are atomic: if either transfer
        // fails or a token has a fee/non-exact transfer, the full invocation
        // reverts and the first transfer is not committed.
        pay_exact(&e,&terms.base_token,base_from,base_to,terms.base_amount)?;
        pay_exact(&e,&terms.quote_token,quote_from,quote_to,terms.quote_amount)?;
        let receipt=SettlementReceipt{
            match_id:terms.match_id.clone(),
            maker_order_id:terms.maker_order_id,
            taker_order_id:terms.taker_order_id,
            maker:terms.maker.clone(),
            taker:terms.taker.clone(),
            base_token:terms.base_token.clone(),
            quote_token:terms.quote_token.clone(),
            base_amount:terms.base_amount,
            quote_amount:terms.quote_amount,
            maker_side:terms.maker_side,
            settled_ledger:now,
        };
        e.storage().persistent().set(&receipt_key,&receipt);
        e.storage().persistent().extend_ttl(&receipt_key,TTL_THRESHOLD,TTL_TARGET);
        keep_instance(&e);
        SpotSettled{
            match_id:receipt.match_id.clone(),
            maker:receipt.maker.clone(),
            taker:receipt.taker.clone(),
            base_token:receipt.base_token.clone(),
            quote_token:receipt.quote_token.clone(),
            base_amount:receipt.base_amount,
            quote_amount:receipt.quote_amount,
            settled_ledger:now,
        }.publish(&e);
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests;
