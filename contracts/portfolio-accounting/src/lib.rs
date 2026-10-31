#![no_std]
//! CONSOLIDATED OBSERVATION — NOT LEVERAGED EXECUTION.
//! Read genuine M15 token claims, projected M11 debt/supplier receivables,
//! and M12 actual wallet claims, locked collateral, insurance and fees.
//! No client-provided cash, debt, prices, risk weights, PnL or signatures.
//! Supply shares are NOT double-counted with M15, and M11 nominal debt is
//! a RECEIVABLE—not physically held cash or certain-to-recover collateral.
//! M12 unmarked/unsettled funding/PnL cannot yet be enumerated per account:
//! explicitly flag this limitation and DENY ALL leverage/risk permissions.
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
const TTL_THRESHOLD:u32=100_000;
const TTL_TARGET:u32=400_000;
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct MarginAccount {
    pub available_e7:i128,pub reserved_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct MarginTotals {
    pub user_claims_e7:i128,pub active_reservations:u32,
}
#[contractclient(name="MarginClient")]
pub trait Margin {
    fn collateral_asset(env:Env)->Address;
    fn account(env:Env,owner:Address)->MarginAccount;
    fn totals(env:Env)->MarginTotals;
    fn solvent(env:Env)->bool;
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct LendingPortfolio {
    pub asset:Address,
    pub actual_cash_e7:i128,
    pub accounted_cash_e7:i128,
    pub total_shares_e7:i128,
    pub owner_shares_e7:i128,
    pub owner_supply_claim_e7:i128,
    pub owner_debt_e7:i128,
    pub total_borrowed_e7:i128,
    pub protocol_reserves_e7:i128,
    pub nominal_supplier_claims_e7:i128,
    pub borrow_index_e7:i128,
    pub as_of_sec:u64,
    pub cash_backed:bool,
    pub real_credit_risk_approved:bool,
}
#[contractclient(name="LendingClient")]
pub trait Lending {
    fn projected_portfolio(env:Env,owner:Address)->LendingPortfolio;
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct PerpWallet {
    pub available_e7:i128,pub locked_e7:i128,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct PerpMarket {
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
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct PerpReconciliation {
    pub actual_cash_e7:i128,
    pub user_claims_e7:i128,
    pub accrued_fees_e7:i128,
    pub insurance_reserve_e7:i128,
    pub surplus_e7:i128,
    pub open_positions:u32,
    pub solvent:bool,
}
#[contractclient(name="PerpClient")]
pub trait Perp {
    fn collateral_asset(env:Env)->Address;
    fn wallet(env:Env,owner:Address)->PerpWallet;
    fn market(env:Env)->PerpMarket;
    fn reconciliation(env:Env)->PerpReconciliation;
}
#[contracttype]
#[derive(Clone)]
enum Key { Admin,Asset,Vault,Lending,Perp }
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct PortfolioExposure {
    pub owner:Address,
    pub asset:Address,
    pub as_of_sec:u64,
    // Owner-specific currently stored token-backed claims. M11 supply
    // and loan are book values, NOT M15 spendable collateral.
    pub m15_available_e7:i128,
    pub m15_reserved_e7:i128,
    pub m11_supplier_nominal_e7:i128,
    pub m11_borrower_debt_e7:i128,
    pub m12_available_e7:i128,
    pub m12_locked_e7:i128,
    pub owner_book_before_pnl_e7:i128,
    pub owner_net_after_debt_e7:i128,
    // Global nominal consolidation: M11 RECEIVABLE tracked separately.
    pub actual_cash_across_vaults_e7:i128,
    pub m11_projected_receivables_e7:i128,
    pub nominal_book_assets_e7:i128,
    pub nominal_book_liabilities_e7:i128,
    pub nominal_book_surplus_e7:i128,
    pub liquid_cash_less_claims_e7:i128,
    pub m15_claims_e7:i128,
    pub m11_supplier_liabilities_e7:i128,
    pub m11_protocol_reserves_e7:i128,
    pub m12_claims_e7:i128,
    pub m12_fee_liabilities_e7:i128,
    pub m12_insurance_liabilities_e7:i128,
    pub m12_global_open_positions:u32,
    pub m15_token_backed:bool,
    pub m11_token_cash_backed:bool,
    pub m12_token_backed:bool,
    pub nominal_book_covered:bool,
    pub no_open_credit_or_perp_risk:bool,
    // These are NOT independently proven. No canonical list of per-owner
    // open positions, unrealised PnL, funding liabilities or borrow liquidation.
    pub full_perp_exposure_enumerated:bool,
    pub borrow_credit_loss_risk_priced:bool,
    pub liquidity_only_coverage:bool,
    pub unified_leverage_authorized:bool,
    pub financial_beta_authorized:bool,
}
#[contracttype]
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct AccountingStatus {
    pub read_only:bool,
    pub independent_audit_approved:bool,
    pub full_unrealized_pnl_available:bool,
    pub leveraged_trading_authorized:bool,
    pub mainnet_authorized:bool,
}
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum AccountingError {
    WrongNetwork=1,AssetMismatch=2,NegativeOrInvalidState=3,
    Overflow=4,NotConfigured=5,
}
fn same_network(e:&Env)->Result<(),AccountingError>{
    if e.ledger().network_id()!=BytesN::from_array(e,&TESTNET_ID){
        Err(AccountingError::WrongNetwork)
    }else{Ok(())}
}
fn add(a:i128,b:i128)->Result<i128,AccountingError>{
    a.checked_add(b).ok_or(AccountingError::Overflow)
}
fn sub(a:i128,b:i128)->Result<i128,AccountingError>{
    a.checked_sub(b).ok_or(AccountingError::Overflow)
}
fn nonnegative(nums:&[i128])->Result<(),AccountingError>{
    if nums.iter().any(|v|*v<0){Err(AccountingError::NegativeOrInvalidState)}
    else{Ok(())}
}
fn field(e:&Env,key:Key)->Address{
    e.storage().instance().get(&key).expect("accounting constructor required")
}
#[contract]
pub struct PortfolioAccounting;
#[contractimpl]
impl PortfolioAccounting {
    pub fn __constructor(e:Env,admin:Address,vault:Address,
        lending:Address,perp:Address,asset:Address
    ){
        if same_network(&e).is_err()||vault==lending||vault==perp||
           lending==perp||asset==vault||asset==lending||asset==perp||
           admin==vault||admin==lending||admin==perp{
            panic!("Invalid Hoxo Testnet accounting source addresses");
        }
        admin.require_auth();
        let token=token::TokenClient::new(&e,&asset);
        if token.decimals()!=7||
           MarginClient::new(&e,&vault).collateral_asset()!=asset||
           PerpClient::new(&e,&perp).collateral_asset()!=asset{
            panic!("Hoxo accounting sources require immutable matching seven-decimal token");
        }
        // Lending contract's actual asset must also be validated through
        // its projected portfolio read; this fails closed if state is stale.
        let l=LendingClient::new(&e,&lending).projected_portfolio(&admin);
        if l.asset!=asset{
            panic!("Hoxo lending is not the canonical collateral asset");
        }
        e.storage().instance().set(&Key::Admin,&admin);
        e.storage().instance().set(&Key::Vault,&vault);
        e.storage().instance().set(&Key::Lending,&lending);
        e.storage().instance().set(&Key::Perp,&perp);
        e.storage().instance().set(&Key::Asset,&asset);
        e.storage().instance().extend_ttl(TTL_THRESHOLD,TTL_TARGET);
    }
    /// NEVER usable as risk authorisation or trade/borrow/withdraw control.
    pub fn status()->AccountingStatus{
        AccountingStatus{read_only:true,
            independent_audit_approved:false,full_unrealized_pnl_available:false,
            leveraged_trading_authorized:false,mainnet_authorized:false}
    }
    pub fn approve_borrow(
        _e:Env,_owner:Address,_market:Address,_asset:Address,
        _amount:i128,_projected_debt:i128
    )->bool{false}
    pub fn approve_open(
        _e:Env,_owner:Address,_clearinghouse:Address,_market_id:u32,
        _signed_size:i128,_requested_margin:i128,_mark:i128
    )->bool{false}
    /// Independent read-only estimate of on-chain claims. NEVER estimate
    /// live market value for positions we cannot actually enumerate.
    pub fn snapshot(e:Env,owner:Address)->Result<PortfolioExposure,AccountingError>{
        same_network(&e)?;
        let asset=field(&e,Key::Asset);
        let vault=field(&e,Key::Vault);
        let lend=field(&e,Key::Lending);
        let perp=field(&e,Key::Perp);
        let m=MarginClient::new(&e,&vault);
        let l=LendingClient::new(&e,&lend);
        let p=PerpClient::new(&e,&perp);
        let ledger=m.account(&owner);
        let total=m.totals();
        let loan=l.projected_portfolio(&owner);
        let position=p.wallet(&owner);
        let market=p.market();
        let rec=p.reconciliation();
        if m.collateral_asset()!=asset||loan.asset!=asset||
           market.collateral_token!=asset||p.collateral_asset()!=asset||
           loan.as_of_sec!=e.ledger().timestamp()||
           market.total_user_claims_e7!=rec.user_claims_e7||
           market.open_positions!=rec.open_positions||
           market.insurance_reserves_e7!=rec.insurance_reserve_e7||
           market.accrued_fees_e7!=rec.accrued_fees_e7{
            return Err(AccountingError::AssetMismatch);
        }
        nonnegative(&[
            ledger.available_e7,ledger.reserved_e7,total.user_claims_e7,
            loan.actual_cash_e7,loan.accounted_cash_e7,
            loan.owner_supply_claim_e7,loan.owner_debt_e7,
            loan.total_borrowed_e7,loan.protocol_reserves_e7,
            loan.nominal_supplier_claims_e7,loan.owner_shares_e7,
            position.available_e7,position.locked_e7,
            rec.actual_cash_e7,rec.user_claims_e7,
            rec.accrued_fees_e7,rec.insurance_reserve_e7,
        ])?;
        let t=token::TokenClient::new(&e,&asset);
        let margin_cash=t.balance(&vault);
        let lending_cash=t.balance(&lend);
        let perp_cash=t.balance(&perp);
        nonnegative(&[margin_cash,lending_cash,perp_cash])?;
        let m15_backed=margin_cash>=total.user_claims_e7&&m.solvent();
        let m11_backed=lending_cash>=loan.accounted_cash_e7&&
            loan.cash_backed&&lending_cash==loan.actual_cash_e7;
        let m12_backed=rec.solvent&&perp_cash==rec.actual_cash_e7;
        let book_assets=add(add(add(margin_cash,lending_cash)?,perp_cash)?,
            loan.total_borrowed_e7)?;
        let l_liabilities=add(loan.nominal_supplier_claims_e7,loan.protocol_reserves_e7)?;
        let p_liabilities=add(add(rec.user_claims_e7,rec.accrued_fees_e7)?,
            rec.insurance_reserve_e7)?;
        let all_liabilities=add(add(total.user_claims_e7,l_liabilities)?,p_liabilities)?;
        let cash=add(add(margin_cash,lending_cash)?,perp_cash)?;
        let book_surplus=sub(book_assets,all_liabilities)?;
        let liquid_surplus=sub(cash,all_liabilities)?;
        let owner_assets=add(add(
            add(ledger.available_e7,ledger.reserved_e7)?,
            loan.owner_supply_claim_e7)?,add(position.available_e7,position.locked_e7)?)?;
        let net=sub(owner_assets,loan.owner_debt_e7)?;
        let no_external_risk=loan.total_borrowed_e7==0&&rec.open_positions==0;
        let nominal_covered=m15_backed&&m11_backed&&m12_backed&&book_surplus>=0;
        Ok(PortfolioExposure{
            owner,asset,as_of_sec:e.ledger().timestamp(),
            m15_available_e7:ledger.available_e7,
            m15_reserved_e7:ledger.reserved_e7,
            m11_supplier_nominal_e7:loan.owner_supply_claim_e7,
            m11_borrower_debt_e7:loan.owner_debt_e7,
            m12_available_e7:position.available_e7,
            m12_locked_e7:position.locked_e7,
            owner_book_before_pnl_e7:owner_assets,
            owner_net_after_debt_e7:net,
            actual_cash_across_vaults_e7:cash,
            m11_projected_receivables_e7:loan.total_borrowed_e7,
            nominal_book_assets_e7:book_assets,
            nominal_book_liabilities_e7:all_liabilities,
            nominal_book_surplus_e7:book_surplus,
            liquid_cash_less_claims_e7:liquid_surplus,
            m15_claims_e7:total.user_claims_e7,
            m11_supplier_liabilities_e7:loan.nominal_supplier_claims_e7,
            m11_protocol_reserves_e7:loan.protocol_reserves_e7,
            m12_claims_e7:rec.user_claims_e7,
            m12_fee_liabilities_e7:rec.accrued_fees_e7,
            m12_insurance_liabilities_e7:rec.insurance_reserve_e7,
            m12_global_open_positions:rec.open_positions,
            m15_token_backed:m15_backed,m11_token_cash_backed:m11_backed,
            m12_token_backed:m12_backed,
            nominal_book_covered:nominal_covered,
            no_open_credit_or_perp_risk:no_external_risk,
            full_perp_exposure_enumerated:rec.open_positions==0,
            borrow_credit_loss_risk_priced:false,
            liquidity_only_coverage:nominal_covered&&liquid_surplus>=0&&no_external_risk,
            unified_leverage_authorized:false,financial_beta_authorized:false,
        })
    }
}
#[cfg(test)]
mod tests;
