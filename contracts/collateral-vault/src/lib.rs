#![no_std]
//! M6: isolated Testnet collateral vault. Not linked to risk or settlement.
//! Owner approves transfers. Admin can only allow assets or pause deposits.
//! Stored balances carry a TTL; keepalive operations are required.
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};
const THRESHOLD:u32=100_000;
const TARGET:u32=400_000;
#[contracttype]
#[derive(Clone)]
pub enum Key { Admin, Pause, Allowed(Address), Balance(Address,Address), Total(Address) }
#[contracterror]
#[derive(Copy,Clone,Debug,Eq,PartialEq)]
#[repr(u32)]
pub enum VaultError {
    InvalidAmount=1, Paused=2, UnapprovedAsset=3,
    Insufficient=4, Overflow=5, Insolvent=6,
}
fn renew(e:&Env){e.storage().instance().extend_ttl(THRESHOLD,TARGET);}
fn admin(e:&Env)->Address {e.storage().instance().get(&Key::Admin).expect("constructor required")}
fn balance(e:&Env,owner:&Address,asset:&Address)->i128{
    e.storage().persistent().get(&Key::Balance(owner.clone(),asset.clone())).unwrap_or(0)
}
fn total(e:&Env,asset:&Address)->i128 {
    e.storage().persistent().get(&Key::Total(asset.clone())).unwrap_or(0)
}
fn approved(e:&Env,asset:&Address)->bool {
    e.storage().persistent().get(&Key::Allowed(asset.clone())).unwrap_or(false)
}
fn store_balance(e:&Env,owner:&Address,asset:&Address,value:i128){
    let key=Key::Balance(owner.clone(),asset.clone());
    e.storage().persistent().set(&key,&value);
    e.storage().persistent().extend_ttl(&key,THRESHOLD,TARGET);
}
fn store_total(e:&Env,asset:&Address,value:i128){
    let key=Key::Total(asset.clone());
    e.storage().persistent().set(&key,&value);
    e.storage().persistent().extend_ttl(&key,THRESHOLD,TARGET);
}
#[contract]
pub struct CollateralVault;
#[contractimpl]
impl CollateralVault {
    // Constructor executes atomically at deployment, preventing init race.
    pub fn __constructor(e:Env,owner:Address){
        owner.require_auth();
        e.storage().instance().set(&Key::Admin,&owner);
        e.storage().instance().set(&Key::Pause,&false);
        renew(&e);
    }
    pub fn admin(e:Env)->Address{admin(&e)}
    pub fn deposits_paused(e:Env)->bool{
        e.storage().instance().get(&Key::Pause).unwrap_or(true)
    }
    pub fn asset_enabled(e:Env,asset:Address)->bool{approved(&e,&asset)}
    pub fn set_asset(e:Env,asset:Address,enabled:bool){
        admin(&e).require_auth();
        let key=Key::Allowed(asset);
        e.storage().persistent().set(&key,&enabled);
        e.storage().persistent().extend_ttl(&key,THRESHOLD,TARGET);
        renew(&e);
    }
    pub fn pause(e:Env,paused:bool){
        admin(&e).require_auth();
        e.storage().instance().set(&Key::Pause,&paused);
        renew(&e);
    }
    pub fn change_admin(e:Env,next:Address){
        admin(&e).require_auth();
        next.require_auth();
        e.storage().instance().set(&Key::Admin,&next);
        renew(&e);
    }
    pub fn balance(e:Env,owner:Address,asset:Address)->i128{
        balance(&e,&owner,&asset)
    }
    pub fn total(e:Env,asset:Address)->i128 {total(&e,&asset)}
    pub fn deposit(e:Env,owner:Address,asset:Address,amount:i128)->Result<i128,VaultError>{
        owner.require_auth();
        if amount<=0{return Err(VaultError::InvalidAmount);}
        if Self::deposits_paused(e.clone()){return Err(VaultError::Paused);}
        if !approved(&e,&asset){return Err(VaultError::UnapprovedAsset);}
        let old=balance(&e,&owner,&asset);
        let new=old.checked_add(amount).ok_or(VaultError::Overflow)?;
        let new_total=total(&e,&asset).checked_add(amount).ok_or(VaultError::Overflow)?;
        let vault=e.current_contract_address();
        let token=token::TokenClient::new(&e,&asset);
        let before=token.balance(&vault);
        token.transfer(&owner,&vault,&amount);
        let after=token.balance(&vault);
        if after.checked_sub(before)!=Some(amount) || after<new_total {
            return Err(VaultError::Insolvent);
        }
        store_balance(&e,&owner,&asset,new);
        store_total(&e,&asset,new_total);
        renew(&e);
        Ok(new)
    }
    pub fn withdraw(e:Env,owner:Address,asset:Address,amount:i128)->Result<i128,VaultError>{
        owner.require_auth();
        if amount<=0{return Err(VaultError::InvalidAmount);}
        // Deliberately independent of admin asset list/deposit pause.
        let old=balance(&e,&owner,&asset);
        if old<amount{return Err(VaultError::Insufficient);}
        let prev_total=total(&e,&asset);
        let new_total=prev_total.checked_sub(amount).ok_or(VaultError::Insolvent)?;
        let remainder=old.checked_sub(amount).ok_or(VaultError::Insolvent)?;
        let vault=e.current_contract_address();
        let token=token::TokenClient::new(&e,&asset);
        let before=token.balance(&vault);
        if before<prev_total{return Err(VaultError::Insolvent);}
        // Cross-contract token failure reverts storage mutations atomically.
        store_balance(&e,&owner,&asset,remainder);
        store_total(&e,&asset,new_total);
        token.transfer(&vault,&owner,&amount);
        let after=token.balance(&vault);
        if after.checked_add(amount)!=Some(before) || after<new_total {
            return Err(VaultError::Insolvent);
        }
        renew(&e);
        Ok(remainder)
    }
    // No admin sweep. Anyone can pay storage-rent maintenance costs.
    pub fn keepalive(e:Env,owner:Address,asset:Address){
        let keys=[
            Key::Balance(owner,asset.clone()),
            Key::Total(asset.clone()),
            Key::Allowed(asset)
        ];
        for key in keys {
            if e.storage().persistent().has(&key){
                e.storage().persistent().extend_ttl(&key,THRESHOLD,TARGET);
            }
        }
        renew(&e);
    }
    pub fn solvent(e:Env,asset:Address)->bool{
        token::TokenClient::new(&e,&asset).balance(&e.current_contract_address())>=total(&e,&asset)
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    use soroban_sdk::testutils::Address as _;
    fn setup()->(Env,Address,Address,Address,Address){
        let e=Env::default();
        e.mock_all_auths();
        let administrator=Address::generate(&e);
        let alice=Address::generate(&e);
        let bob=Address::generate(&e);
        let vault=e.register(CollateralVault,(&administrator,));
        let asset=e.register_stellar_asset_contract_v2(administrator.clone()).address();
        let mint=token::StellarAssetClient::new(&e,&asset);
        mint.mint(&alice,&1000);
        mint.mint(&bob,&200);
        (e,vault,asset,alice,bob)
    }
    #[test]
    fn deposits_two_users_and_withdraws_without_cross_account_leak(){
        let (e,id,asset,alice,bob)=setup();
        let vault=CollateralVaultClient::new(&e,&id);
        let token=token::TokenClient::new(&e,&asset);
        vault.set_asset(&asset,&true);
        assert_eq!(vault.deposit(&alice,&asset,&200),200);
        assert_eq!(vault.deposit(&bob,&asset,&50),50);
        assert_eq!(vault.balance(&alice,&asset),200);
        assert_eq!(vault.balance(&bob,&asset),50);
        assert_eq!(vault.total(&asset),250);
        assert_eq!(token.balance(&id),250);
        assert_eq!(vault.withdraw(&alice,&asset,&100),100);
        assert_eq!(token.balance(&alice),900);
        assert_eq!(vault.total(&asset),150);
        assert!(vault.solvent(&asset));
    }
    #[test]
    fn pause_and_delist_never_lock_an_existing_user_balance(){
        let (e,id,asset,alice,_)=setup();
        let vault=CollateralVaultClient::new(&e,&id);
        vault.set_asset(&asset,&true);
        vault.deposit(&alice,&asset,&80);
        vault.pause(&true);
        assert!(vault.try_deposit(&alice,&asset,&10).is_err());
        vault.set_asset(&asset,&false);
        assert_eq!(vault.withdraw(&alice,&asset,&80),0);
    }
    #[test]
    fn unapproved_signer_cannot_withdraw_when_auth_mocks_are_disabled(){
        let (e,id,asset,alice,_)=setup();
        let vault=CollateralVaultClient::new(&e,&id);
        vault.set_asset(&asset,&true);
        vault.deposit(&alice,&asset,&30);
        e.set_auths(&[]);
        // set_auths disables all-auth mocks; no signer provided for this call.
        assert!(vault.try_withdraw(&alice,&asset,&1).is_err());
        assert_eq!(vault.balance(&alice,&asset),30);
        assert_eq!(vault.total(&asset),30);
    }
    #[test]
    fn unauthorized_admin_cannot_pause_deposits(){
        let (e,id,asset,alice,_)=setup();
        let vault=CollateralVaultClient::new(&e,&id);
        vault.set_asset(&asset,&true);
        e.set_auths(&[]);
        assert!(vault.try_pause(&true).is_err());
        assert_eq!(vault.deposits_paused(),false);
        assert_eq!(vault.balance(&alice,&asset),0);
    }
    #[test]
    fn unapproved_token_and_overwithdraw_rejected(){
        let (e,id,asset,alice,bob)=setup();
        let vault=CollateralVaultClient::new(&e,&id);
        assert!(vault.try_deposit(&alice,&asset,&10).is_err());
        vault.set_asset(&asset,&true);
        vault.deposit(&alice,&asset,&30);
        assert!(vault.try_withdraw(&bob,&asset,&1).is_err());
        assert!(vault.try_withdraw(&alice,&asset,&31).is_err());
        assert!(vault.try_deposit(&alice,&asset,&0).is_err());
        assert_eq!(vault.balance(&alice,&asset),30);
    }
}
