#![no_std]
//! Custody Handoff — Testnet-only atomic, double-claim-resistant routing.
//! M9 quote-settlement: buyer FREE collateral -> actual 2-token DvP ->
//! seller's FREE M15 collateral within a single Soroban invocation.
//! M11/M12: custody is transferred ATOMICALLY from M15 to a product's
//! independent vault, and reverse, only while both have ZERO active debt/
//! positions. The product share/collateral ISOLATED claims never equal
//! spendable M15 balance simultaneously. This is NOT unified risk capital,
//! leverage, audited financial beta, live contract integration or deployment.
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
const MAX_HANDOFF_E7:i128=1_000*10_000_000;
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Account{pub available_e7:i128,pub reserved_e7:i128}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Totals{pub user_claims_e7:i128,pub active_reservations:u32}
#[contractclient(name="MarginClient")]
pub trait Margin{
    fn collateral_asset(env:Env)->Address;
    fn account(env:Env,owner:Address)->Account;
    fn totals(env:Env)->Totals;
    fn solvent(env:Env)->bool;
    fn withdraw(env:Env,owner:Address,amount:i128)->i128;
    fn deposit(env:Env,owner:Address,amount:i128)->i128;
}
#[contractclient(name="LendingClient")]
pub trait Lending{
    fn asset(env:Env)->Address;
    fn current_outstanding_debt_e7(env:Env)->i128;
    fn debt_of(env:Env,borrower:Address)->i128;
    fn repay(env:Env,payer:Address,borrower:Address,max_amount_e7:i128)->i128;
    fn solvent(env:Env)->bool;
    fn supply(env:Env,owner:Address,amount_e7:i128)->i128;
    fn redeem(env:Env,owner:Address,shares_e7:i128)->i128;
}
#[contractclient(name="PerpClient")]
pub trait Perp{
    fn collateral_asset(env:Env)->Address;
    fn active_positions(env:Env)->u32;
    fn solvent(env:Env)->bool;
    fn deposit(env:Env,owner:Address,amount_e7:i128)->i128;
    fn withdraw(env:Env,owner:Address,amount_e7:i128)->i128;
}
#[contracttype]
#[derive(Clone,Debug)]
pub struct MatchTerms{
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
    pub maker_limit_e7:i128,
    pub taker_limit_e7:i128,
    pub expires_at_ledger:u32,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct SettlementReceipt{
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
#[contractclient(name="SpotClient")]
pub trait Spot{
    fn paused(env:Env)->bool;
    fn allowed(env:Env,token_addr:Address)->bool;
    fn settle(env:Env,terms:MatchTerms)->SettlementReceipt;
}
#[contracttype]
#[derive(Clone)]
enum Key{Admin,Vault,Spot,Lending,Perp,Asset,Paused}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Handoff{
    pub owner:Address,
    pub source:Address,
    pub destination:Address,
    pub asset:Address,
    pub tokens_e7:i128,
    pub share_units_e7:i128,
    pub ledger:u32,
    pub isolated_not_shared:bool,
}
/// User-initiated repayment of an EXISTING M11 debt from UNRESERVED M15
/// collateral. No liquidation, debt forgiveness, lending origination, or
/// cross-product borrowing authority is granted.
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct DebtRepayment{
    pub owner:Address,
    pub source:Address,
    pub destination:Address,
    pub asset:Address,
    pub paid_e7:i128,
    pub owner_debt_before_e7:i128,
    pub owner_debt_after_e7:i128,
    pub market_debt_after_e7:i128,
    pub ledger:u32,
    pub owner_authorized:bool,
    pub liquidation_executed:bool,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct RouterStatus{
    pub paused:bool,
    pub can_borrow_against_m15:bool,
    pub can_open_perps_against_m15:bool,
    pub financial_beta_approved:bool,
    pub max_handoff_e7:i128,
}
#[contracterror]
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
#[repr(u32)]
pub enum HandoffError{
    WrongNetwork=1,InvalidInput=2,Paused=3,AssetMismatch=4,
    ActiveDebt=5,ActivePositions=6,Insolvent=7,
    AccountingMismatch=8,Unapproved=9,Overflow=10,NoDebt=11,
}
fn testnet(e:&Env)->Result<(),HandoffError>{
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(HandoffError::WrongNetwork)
    }else{Ok(())}
}
fn addr(e:&Env,key:Key)->Address{
    e.storage().instance().get(&key).expect("router constructor")
}
fn keep(e:&Env){e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);}
fn check(e:&Env,amount:i128)->Result<(),HandoffError>{
    testnet(e)?;
    if e.storage().instance().get::<_,bool>(&Key::Paused).unwrap_or(true){
        return Err(HandoffError::Paused);
    }
    if amount<=0||amount>MAX_HANDOFF_E7{return Err(HandoffError::InvalidInput);}
    Ok(())
}
fn exact_delta(before:i128,after:i128,delta:i128,positive:bool)->Result<(),HandoffError>{
    let expected=if positive {before.checked_add(delta)}else{before.checked_sub(delta)};
    if expected!=Some(after){Err(HandoffError::AccountingMismatch)}else{Ok(())}
}
fn margin_check(e:&Env,vault:&Address,asset:&Address)->Result<(),HandoffError>{
    let m=MarginClient::new(e,vault);
    if m.collateral_asset()!=*asset||!m.solvent(){
        return Err(HandoffError::Insolvent);
    }
    Ok(())
}
fn ensure_lending(e:&Env,lending:&Address,asset:&Address)->Result<(),HandoffError>{
    let l=LendingClient::new(e,lending);
    if l.asset()!=*asset{return Err(HandoffError::AssetMismatch);}
    // Interest MUST be projected to the current ledger; stale/long-unaccrued
    // loans return an error and automatically deny the entire handoff.
    if l.current_outstanding_debt_e7()!=0{return Err(HandoffError::ActiveDebt);}
    if !l.solvent(){return Err(HandoffError::Insolvent);}
    Ok(())
}
fn ensure_perp(e:&Env,perp:&Address,asset:&Address)->Result<(),HandoffError>{
    let p=PerpClient::new(e,perp);
    if p.collateral_asset()!=*asset{return Err(HandoffError::AssetMismatch);}
    if p.active_positions()!=0{return Err(HandoffError::ActivePositions);}
    if !p.solvent(){return Err(HandoffError::Insolvent);}
    Ok(())
}
#[contract]
pub struct CustodyRouter;
#[contractimpl]
impl CustodyRouter{
    pub fn __constructor(
        e:Env,admin:Address,vault:Address,spot:Address,
        lending:Address,perp:Address,asset:Address
    ){
        if testnet(&e).is_err()||vault==spot||vault==lending||
           vault==perp||spot==lending||spot==perp||
           lending==perp||asset==vault||asset==spot||asset==lending||
           asset==perp{
            panic!("invalid Testnet custody router contracts");
        }
        admin.require_auth();
        if token::TokenClient::new(&e,&asset).decimals()!=7||
           MarginClient::new(&e,&vault).collateral_asset()!=asset||
           LendingClient::new(&e,&lending).asset()!=asset||
           PerpClient::new(&e,&perp).collateral_asset()!=asset{
            panic!("custody router requires the same real seven-decimal token");
        }
        e.storage().instance().set(&Key::Admin,&admin);
        e.storage().instance().set(&Key::Vault,&vault);
        e.storage().instance().set(&Key::Spot,&spot);
        e.storage().instance().set(&Key::Lending,&lending);
        e.storage().instance().set(&Key::Perp,&perp);
        e.storage().instance().set(&Key::Asset,&asset);
        e.storage().instance().set(&Key::Paused,&true);
        keep(&e);
    }
    pub fn status(e:Env)->RouterStatus{
        RouterStatus{
            paused:e.storage().instance().get(&Key::Paused).unwrap_or(true),
            can_borrow_against_m15:false,
            can_open_perps_against_m15:false,
            financial_beta_approved:false,
            max_handoff_e7:MAX_HANDOFF_E7,
        }
    }
    pub fn pause(e:Env,paused:bool)->Result<(),HandoffError>{
        testnet(&e)?;
        addr(&e,Key::Admin).require_auth();
        e.storage().instance().set(&Key::Paused,&paused);
        keep(&e);
        Ok(())
    }
    /// M15 free collateral -> isolated M11 pool. One transaction, one token.
    /// M11 share is minted ONLY after M15 claim is debited and tokens move.
    /// No borrowing whatsoever; zero outstanding debt checked BOTH sides.
    pub fn supply_from_margin(e:Env,owner:Address,amount_e7:i128)->Result<Handoff,HandoffError>{
        check(&e,amount_e7)?;
        owner.require_auth();
        let vault=addr(&e,Key::Vault);
        let lending=addr(&e,Key::Lending);
        let asset=addr(&e,Key::Asset);
        margin_check(&e,&vault,&asset)?;
        ensure_lending(&e,&lending,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let l=LendingClient::new(&e,&lending);
        let t=token::TokenClient::new(&e,&asset);
        let old_total=m.totals().user_claims_e7;
        let old_v=t.balance(&vault);
        let old_p=t.balance(&lending);
        let old_wallet=t.balance(&owner);
        m.withdraw(&owner,&amount_e7);
        let shares=l.supply(&owner,&amount_e7);
        if shares<=0{return Err(HandoffError::AccountingMismatch);}
        exact_delta(old_total,m.totals().user_claims_e7,amount_e7,false)?;
        exact_delta(old_v,t.balance(&vault),amount_e7,false)?;
        exact_delta(old_p,t.balance(&lending),amount_e7,true)?;
        if t.balance(&owner)!=old_wallet||!m.solvent()||!l.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        ensure_lending(&e,&lending,&asset)?;
        keep(&e);
        Ok(Handoff{owner,source:vault,destination:lending,asset,
            tokens_e7:amount_e7,share_units_e7:shares,
            ledger:e.ledger().sequence(),isolated_not_shared:true})
    }
    /// Isolated M11 share redemption, followed by exact M15 deposit.
    /// Still no debt; if M15 deposits are paused the WHOLE operation reverts.
    /// User can always redeem directly from M11 independently of this router.
    pub fn redeem_to_margin(e:Env,owner:Address,shares_e7:i128)->Result<Handoff,HandoffError>{
        check(&e,shares_e7)?;
        owner.require_auth();
        let vault=addr(&e,Key::Vault);
        let lending=addr(&e,Key::Lending);
        let asset=addr(&e,Key::Asset);
        margin_check(&e,&vault,&asset)?;
        ensure_lending(&e,&lending,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let l=LendingClient::new(&e,&lending);
        let t=token::TokenClient::new(&e,&asset);
        let old_total=m.totals().user_claims_e7;
        let old_v=t.balance(&vault);
        let old_p=t.balance(&lending);
        let old_wallet=t.balance(&owner);
        let tokens=l.redeem(&owner,&shares_e7);
        if tokens<=0||tokens>MAX_HANDOFF_E7{return Err(HandoffError::InvalidInput);}
        m.deposit(&owner,&tokens);
        exact_delta(old_total,m.totals().user_claims_e7,tokens,true)?;
        exact_delta(old_v,t.balance(&vault),tokens,true)?;
        exact_delta(old_p,t.balance(&lending),tokens,false)?;
        if t.balance(&owner)!=old_wallet||!m.solvent()||!l.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        ensure_lending(&e,&lending,&asset)?;
        keep(&e);
        Ok(Handoff{owner,source:lending,destination:vault,asset,
            tokens_e7:tokens,share_units_e7:shares_e7,
            ledger:e.ledger().sequence(),isolated_not_shared:true})
    }
    /// M15 free margin -> isolated M12 margin, zero open positions.
    /// This is an EXPLICIT TRANSFER, not double use of the same collateral.
    pub fn perp_from_margin(e:Env,owner:Address,amount_e7:i128)->Result<Handoff,HandoffError>{
        check(&e,amount_e7)?;
        owner.require_auth();
        let vault=addr(&e,Key::Vault);
        let perp=addr(&e,Key::Perp);
        let asset=addr(&e,Key::Asset);
        margin_check(&e,&vault,&asset)?;
        ensure_perp(&e,&perp,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let p=PerpClient::new(&e,&perp);
        let t=token::TokenClient::new(&e,&asset);
        let old_total=m.totals().user_claims_e7;
        let old_v=t.balance(&vault);
        let old_p=t.balance(&perp);
        let old_wallet=t.balance(&owner);
        m.withdraw(&owner,&amount_e7);
        p.deposit(&owner,&amount_e7);
        exact_delta(old_total,m.totals().user_claims_e7,amount_e7,false)?;
        exact_delta(old_v,t.balance(&vault),amount_e7,false)?;
        exact_delta(old_p,t.balance(&perp),amount_e7,true)?;
        if t.balance(&owner)!=old_wallet||!m.solvent()||!p.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        ensure_perp(&e,&perp,&asset)?;
        keep(&e);
        Ok(Handoff{owner,source:vault,destination:perp,asset,
            tokens_e7:amount_e7,share_units_e7:0,
            ledger:e.ledger().sequence(),isolated_not_shared:true})
    }
    /// M38 — OWNER-SIGNED SINGLE-ASSET DEBT REPAYMENT FROM FREE M15.
    ///
    /// The user's existing M15 FREE claim pays down their existing M11 debt
    /// in the SAME root Soroban invocation. M15 withdraw and M11 repay each
    /// independently require this owner's authorization, and all token moves,
    /// debt share burns and claim reductions roll back if any check fails.
    ///
    /// This is deliberately NOT permissionless liquidation and cannot spend
    /// reserved margin, another owner's collateral, M12 locked escrow or
    /// any shared insurance. Both custodians must remain solvent.
    /// The caller must specify the EXACT amount that M11 will accept after
    /// integer debt-share rounding; otherwise this invocation fails closed.
    /// Repayment is available even if NEW M11 borrowing has been disabled,
    /// but the convenience router itself must be explicitly unpaused.
    pub fn repay_debt_from_margin(
        e:Env,owner:Address,amount_e7:i128
    )->Result<DebtRepayment,HandoffError>{
        check(&e,amount_e7)?;
        owner.require_auth();
        let vault=addr(&e,Key::Vault);
        let lending=addr(&e,Key::Lending);
        let asset=addr(&e,Key::Asset);
        margin_check(&e,&vault,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let l=LendingClient::new(&e,&lending);
        let t=token::TokenClient::new(&e,&asset);
        if l.asset()!=asset{return Err(HandoffError::AssetMismatch);}
        if !l.solvent(){return Err(HandoffError::Insolvent);}
        let debt_before=l.debt_of(&owner);
        if debt_before<=0{return Err(HandoffError::NoDebt);}
        if amount_e7>debt_before{return Err(HandoffError::InvalidInput);}
        if m.account(&owner).available_e7<amount_e7{
            return Err(HandoffError::InvalidInput);
        }
        let market_before=l.current_outstanding_debt_e7();
        if market_before<debt_before{
            return Err(HandoffError::AccountingMismatch);
        }
        let old_claims=m.totals().user_claims_e7;
        let old_free=m.account(&owner).available_e7;
        let vault_before=t.balance(&vault);
        let lending_before=t.balance(&lending);
        let wallet_before=t.balance(&owner);
        // Crucial: both contract calls run under ONE Soroban transaction,
        // not two independently committed client operations.
        m.withdraw(&owner,&amount_e7);
        let paid=l.repay(&owner,&owner,&amount_e7);
        if paid!=amount_e7{return Err(HandoffError::AccountingMismatch);}
        let debt_after=l.debt_of(&owner);
        let market_after=l.current_outstanding_debt_e7();
        if debt_after>=debt_before||debt_after<0||market_after<0{
            return Err(HandoffError::AccountingMismatch);
        }
        exact_delta(old_free,m.account(&owner).available_e7,paid,false)?;
        exact_delta(old_claims,m.totals().user_claims_e7,paid,false)?;
        exact_delta(vault_before,t.balance(&vault),paid,false)?;
        exact_delta(lending_before,t.balance(&lending),paid,true)?;
        exact_delta(market_before,market_after,paid,false)?;
        if t.balance(&owner)!=wallet_before||!m.solvent()||!l.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        keep(&e);
        Ok(DebtRepayment{
            owner,source:vault,destination:lending,asset,
            paid_e7:paid,owner_debt_before_e7:debt_before,
            owner_debt_after_e7:debt_after,market_debt_after_e7:market_after,
            ledger:e.ledger().sequence(),
            owner_authorized:true,liquidation_executed:false,
        })
    }
    /// M12 FREE margin -> M15 FREE margin. Locked collateral cannot escape.
    /// Standalone M12 owner withdrawals remain available while paused.
    pub fn perp_to_margin(e:Env,owner:Address,amount_e7:i128)->Result<Handoff,HandoffError>{
        check(&e,amount_e7)?;
        owner.require_auth();
        let vault=addr(&e,Key::Vault);
        let perp=addr(&e,Key::Perp);
        let asset=addr(&e,Key::Asset);
        margin_check(&e,&vault,&asset)?;
        ensure_perp(&e,&perp,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let p=PerpClient::new(&e,&perp);
        let t=token::TokenClient::new(&e,&asset);
        let old_total=m.totals().user_claims_e7;
        let old_v=t.balance(&vault);
        let old_p=t.balance(&perp);
        let old_wallet=t.balance(&owner);
        p.withdraw(&owner,&amount_e7);
        m.deposit(&owner,&amount_e7);
        exact_delta(old_total,m.totals().user_claims_e7,amount_e7,true)?;
        exact_delta(old_v,t.balance(&vault),amount_e7,true)?;
        exact_delta(old_p,t.balance(&perp),amount_e7,false)?;
        if t.balance(&owner)!=old_wallet||!m.solvent()||!p.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        ensure_perp(&e,&perp,&asset)?;
        keep(&e);
        Ok(Handoff{owner,source:perp,destination:vault,asset,
            tokens_e7:amount_e7,share_units_e7:0,
            ledger:e.ledger().sequence(),isolated_not_shared:true})
    }
    /// M9 quote DvP on canonical M15: buyer withdraws exact FREE quote,
    /// both parties authorise the exact M9 order, seller deposits the SAME
    /// quote back into canonical M15. Only base token leaves owner wallets.
    /// M9's unique match_id and two-sided price limits remain authoritative.
    /// Not an M15 *reserved* order; matches cannot spend locked collateral.
    pub fn settle_spot_from_margin(
        e:Env,terms:MatchTerms
    )->Result<SettlementReceipt,HandoffError>{
        check(&e,terms.quote_amount)?;
        if terms.maker_side>1||terms.base_amount<=0{
            return Err(HandoffError::InvalidInput);
        }
        let vault=addr(&e,Key::Vault);
        let spot=addr(&e,Key::Spot);
        let asset=addr(&e,Key::Asset);
        if terms.quote_token!=asset||terms.base_token==asset||
           terms.maker==terms.taker{
            return Err(HandoffError::AssetMismatch);
        }
        let (buyer,seller)=if terms.maker_side==0{
            (terms.taker.clone(),terms.maker.clone())
        }else{(terms.maker.clone(),terms.taker.clone())};
        buyer.require_auth();
        seller.require_auth();
        margin_check(&e,&vault,&asset)?;
        let m=MarginClient::new(&e,&vault);
        let s=SpotClient::new(&e,&spot);
        let q=token::TokenClient::new(&e,&asset);
        let b=token::TokenClient::new(&e,&terms.base_token);
        if s.paused()||!s.allowed(&asset)||!s.allowed(&terms.base_token){
            return Err(HandoffError::Unapproved);
        }
        let old_total=m.totals().user_claims_e7;
        let old_v=q.balance(&vault);
        let old_buyer=m.account(&buyer).available_e7;
        let old_seller=m.account(&seller).available_e7;
        let old_buyer_q=q.balance(&buyer);
        let old_seller_q=q.balance(&seller);
        let old_buyer_b=b.balance(&buyer);
        let old_seller_b=b.balance(&seller);
        m.withdraw(&buyer,&terms.quote_amount);
        let receipt=s.settle(&terms);
        m.deposit(&seller,&terms.quote_amount);
        if m.totals().user_claims_e7!=old_total||q.balance(&vault)!=old_v||
           q.balance(&buyer)!=old_buyer_q||q.balance(&seller)!=old_seller_q||
           !m.solvent(){
            return Err(HandoffError::AccountingMismatch);
        }
        exact_delta(old_buyer,m.account(&buyer).available_e7,terms.quote_amount,false)?;
        exact_delta(old_seller,m.account(&seller).available_e7,terms.quote_amount,true)?;
        exact_delta(old_buyer_b,b.balance(&buyer),terms.base_amount,true)?;
        exact_delta(old_seller_b,b.balance(&seller),terms.base_amount,false)?;
        if receipt.match_id!=terms.match_id||receipt.quote_amount!=terms.quote_amount||
           receipt.base_amount!=terms.base_amount{
            return Err(HandoffError::AccountingMismatch);
        }
        keep(&e);
        Ok(receipt)
    }
}
#[cfg(test)]
mod tests;
