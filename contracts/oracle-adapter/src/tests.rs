use super::*;
use soroban_sdk::testutils::{Address as _,Ledger as _};
const UNIT:i128=10_000_000;
fn setup()->(Env,Address,Address,Address,Address){
    let e=Env::default();
    e.ledger().set_network_id(TESTNET_ID);
    e.mock_all_auths();
    let admin=Address::generate(&e);
    let a=Address::generate(&e);
    let b=Address::generate(&e);
    let id=e.register(OracleAdapter,(&admin,&1u32,&a,&b));
    (e,id,admin,a,b)
}
fn tick(e:&Env){
    e.ledger().with_mut(|l|{
        l.sequence_number+=1;
        l.timestamp+=5;
    });
}
fn submit(e:&Env,id:&Address,signer:&Address,price:i128){
    OracleAdapterClient::new(e,id).submit(signer,&1,&price,&price);
}
#[test]
fn starts_paused_and_with_no_fabricated_fresh_feed(){
    let (e,id,_,a,_,)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    assert_eq!(c.status(),(true,1,false,false));
    assert!(c.try_submit(&a,&1,&UNIT,&UNIT).is_err());
    assert!(c.try_current(&1).is_err());
    assert!(!c.execution_approved());
}
#[test]
fn two_independent_sources_required_for_candidate_price(){
    let (e,id,_,a,b)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    submit(&e,&id,&a,10*UNIT);
    assert!(c.try_current(&1).is_err());
    submit(&e,&id,&b,10*UNIT);
    let p=c.current(&1);
    assert_eq!(p.mark_e7,10*UNIT);
    assert_eq!(p.index_e7,10*UNIT);
    assert_eq!(p.updated_at_sec,e.ledger().timestamp());
    assert!(!c.execution_approved());
}
#[test]
fn duplicate_report_same_ledger_invalid_and_unauthorised_publisher_does_not_write(){
    let (e,id,_,a,b)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    let stranger=Address::generate(&e);
    assert!(c.try_submit(&stranger,&1,&UNIT,&UNIT).is_err());
    submit(&e,&id,&a,10*UNIT);
    assert!(c.try_submit(&a,&1,&(11*UNIT),&(11*UNIT)).is_err());
    tick(&e);
    submit(&e,&id,&b,10*UNIT);
    let value=c.current(&1);
    assert_eq!(value.mark_e7,10*UNIT);
}
#[test]
fn oracle_rejects_source_disagreement_and_mark_index_deviation(){
    let (e,id,_,a,b)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    submit(&e,&id,&a,10*UNIT);
    submit(&e,&id,&b,10*UNIT);
    tick(&e);
    c.submit(&a,&1,&(12*UNIT),&(12*UNIT));
    assert!(c.try_current(&1).is_err());
    tick(&e);
    assert!(c.try_submit(&b,&1,&(12*UNIT),&(10*UNIT)).is_err());
    c.submit(&b,&1,&(12*UNIT),&(12*UNIT));
    assert_eq!(c.current(&1).mark_e7,12*UNIT);
}
#[test]
fn time_expiry_pause_and_network_mismatch_fail_closed(){
    let (e,id,_,a,b)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    submit(&e,&id,&a,10*UNIT);
    submit(&e,&id,&b,10*UNIT);
    e.ledger().with_mut(|l|{l.timestamp+=121;l.sequence_number+=1;});
    assert!(c.try_current(&1).is_err());
    c.pause(&true);
    assert!(c.try_current(&1).is_err());
    c.pause(&false);
    assert!(c.try_current(&1).is_err());
    submit(&e,&id,&a,10*UNIT);
    submit(&e,&id,&b,10*UNIT);
    assert_eq!(c.current(&1).mark_e7,10*UNIT);
    e.ledger().set_network_id([0;32]);
    assert!(c.try_current(&1).is_err());
    assert!(c.try_submit(&a,&1,&UNIT,&UNIT).is_err());
}
#[test]
fn negative_zero_huge_and_wrong_market_reports_are_refused(){
    let (e,id,_,a,_)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    for n in [0,-1,i128::MAX,MAX_PRICE_E7+1]{
        assert!(c.try_submit(&a,&1,&n,&n).is_err());
    }
    assert!(c.try_submit(&a,&2,&UNIT,&UNIT).is_err());
    assert!(c.try_current(&2).is_err());
}
#[test]
fn signature_enforcement_requires_real_operator_identity_when_mock_disabled(){
    let (e,id,admin,a,_)=setup();
    let c=OracleAdapterClient::new(&e,&id);
    c.pause(&false);
    e.set_auths(&[]);
    assert!(c.try_submit(&a,&1,&UNIT,&UNIT).is_err());
    assert!(c.try_pause(&true).is_err());
    assert!(c.try_submit(&admin,&1,&UNIT,&UNIT).is_err());
}
