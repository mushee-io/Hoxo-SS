    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    fn setup() -> (Env,Address,Address,Address,Address,Address,Address) {
        let e=Env::default();
        e.mock_all_auths(); // Positive-path signing is mocked in native tests.
        let admin=Address::generate(&e);
        let maker=Address::generate(&e);
        let taker=Address::generate(&e);
        let base=e.register_stellar_asset_contract_v2(admin.clone()).address();
        let quote=e.register_stellar_asset_contract_v2(admin.clone()).address();
        let base_mint=token::StellarAssetClient::new(&e,&base);
        let quote_mint=token::StellarAssetClient::new(&e,&quote);
        base_mint.mint(&maker,&(100*SCALE));
        base_mint.mint(&taker,&(100*SCALE));
        quote_mint.mint(&maker,&(500*SCALE));
        quote_mint.mint(&taker,&(500*SCALE));
        let contract=e.register(SpotSettlement,(&admin,));
        let client=SpotSettlementClient::new(&e,&contract);
        client.set_asset(&base,&true);
        client.set_asset(&quote,&true);
        (e,contract,admin,maker,taker,base,quote)
    }
    fn terms(e:&Env,maker:&Address,taker:&Address,base:&Address,quote:&Address,id:u8,side:u32)->MatchTerms {
        MatchTerms {
            match_id:BytesN::from_array(e,&[id;32]),
            maker_order_id:BytesN::from_array(e,&[id+1;32]),
            taker_order_id:BytesN::from_array(e,&[id+2;32]),
            maker:maker.clone(),
            taker:taker.clone(),
            base_token:base.clone(),
            quote_token:quote.clone(),
            base_amount:4*SCALE,
            quote_amount:8*SCALE,
            maker_side:side,
            maker_limit_e7:if side==0 {19_000_000}else{21_000_000},
            taker_limit_e7:if side==0 {21_000_000}else{19_000_000},
            expires_at_ledger:e.ledger().sequence()+20,
        }
    }
    fn open(e:&Env,contract:&Address){
        SpotSettlementClient::new(e,contract).set_pause(&false);
    }
    #[test]
    fn constructor_defaults_to_paused_and_no_assets(){
        let (e,id,_,_,_,base,_)=setup();
        let c=SpotSettlementClient::new(&e,&id);
        assert!(c.paused());
        assert!(c.allowed(&base));
        let unlisted=Address::generate(&e);
        assert!(!c.allowed(&unlisted));
    }
    #[test]
    fn maker_sells_base_for_quote_and_receipt_is_replay_protected(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let b=token::TokenClient::new(&e,&base);
        let q=token::TokenClient::new(&e,&quote);
        let fill=terms(&e,&maker,&taker,&base,&quote,3,0);
        let before_mb=b.balance(&maker);
        let before_tb=b.balance(&taker);
        let before_mq=q.balance(&maker);
        let before_tq=q.balance(&taker);
        let receipt=c.settle(&fill);
        assert_eq!(receipt.match_id,fill.match_id);
        assert_eq!(receipt.maker, maker);
        assert_eq!(receipt.taker,taker);
        assert_eq!(receipt.base_amount,4*SCALE);
        assert_eq!(receipt.quote_amount,8*SCALE);
        assert_eq!(receipt.maker_side,0);
        assert_eq!(b.balance(&maker),before_mb-4*SCALE);
        assert_eq!(b.balance(&taker),before_tb+4*SCALE);
        assert_eq!(q.balance(&maker),before_mq+8*SCALE);
        assert_eq!(q.balance(&taker),before_tq-8*SCALE);
        assert!(c.is_settled(&fill.match_id));
        assert_eq!(c.receipt(&fill.match_id),Some(receipt));
        assert!(c.try_settle(&fill).is_err());
        assert_eq!(b.balance(&maker),before_mb-4*SCALE);
    }
    #[test]
    fn maker_buys_base_and_pays_quote_reverse_direction(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let b=token::TokenClient::new(&e,&base);
        let q=token::TokenClient::new(&e,&quote);
        let before_mb=b.balance(&maker);let before_mq=q.balance(&maker);
        let fill=terms(&e,&maker,&taker,&base,&quote,7,1);
        c.settle(&fill);
        assert_eq!(b.balance(&maker),before_mb+4*SCALE);
        assert_eq!(q.balance(&maker),before_mq-8*SCALE);
    }
    #[test]
    fn minimum_and_maximum_price_bounds_reject_both_sides(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let sell=terms(&e,&maker,&taker,&base,&quote,11,0);
        let too_low=MatchTerms {quote_amount:7*SCALE,..sell.clone()};
        let too_high=MatchTerms {quote_amount:9*SCALE,..sell.clone()};
        assert!(c.try_settle(&too_low).is_err());
        assert!(c.try_settle(&too_high).is_err());
        let buy=terms(&e,&maker,&taker,&base,&quote,12,1);
        assert!(c.try_settle(&MatchTerms {quote_amount:9*SCALE,..buy.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms {quote_amount:7*SCALE,..buy.clone()}).is_err());
        assert!(!c.is_settled(&sell.match_id));
    }
    #[test]
    fn zero_negative_and_invalid_side_assets_accounts_and_limits_fail_closed(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let fill=terms(&e,&maker,&taker,&base,&quote,13,0);
        assert!(c.try_settle(&MatchTerms{base_amount:0,..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{quote_amount:-10,..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{maker_side:2,..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{maker:taker.clone(),..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{quote_token:base.clone(),..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{taker_order_id:fill.maker_order_id.clone(),..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{maker_limit_e7:0,..fill.clone()}).is_err());
        assert!(c.try_settle(&MatchTerms{base_amount:i128::MAX,..fill.clone()}).is_err());
        assert!(!c.is_settled(&fill.match_id));
    }
    #[test]
    fn paused_and_delisted_tokens_block_new_settlements(){
        let (e,id,_,maker,taker,base,quote)=setup();
        let c=SpotSettlementClient::new(&e,&id);
        let fill=terms(&e,&maker,&taker,&base,&quote,17,0);
        assert!(c.try_settle(&fill).is_err()); // constructor is paused
        c.set_pause(&false);
        c.set_asset(&base,&false);
        assert!(c.try_settle(&fill).is_err());
        c.set_asset(&base,&true);
        c.set_pause(&true);
        assert!(c.try_settle(&fill).is_err());
        assert!(!c.is_settled(&fill.match_id));
    }
    #[test]
    fn short_ledger_expiry_and_huge_future_deadlines_are_rejected(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let fill=terms(&e,&maker,&taker,&base,&quote,18,0);
        assert!(c.try_settle(&MatchTerms{expires_at_ledger:e.ledger().sequence()+101,..fill.clone()}).is_err());
        e.ledger().with_mut(|li|li.sequence_number += 21);
        assert!(c.try_settle(&fill).is_err());
        assert!(!c.is_settled(&fill.match_id));
    }
    #[test]
    fn insufficient_quote_balance_aborts_both_token_transfers(){
        let (e,id,_admin,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let b=token::TokenClient::new(&e,&base);
        let q=token::TokenClient::new(&e,&quote);
        let before=b.balance(&maker);
        // Taker has 500 quote; ask 600 quote for 4 base at 150 quote/base.
        let fill=MatchTerms{
          quote_amount:600*SCALE,maker_limit_e7:149*SCALE,taker_limit_e7:151*SCALE,
          ..terms(&e,&maker,&taker,&base,&quote,22,0)
        };
        assert!(c.try_settle(&fill).is_err());
        assert_eq!(b.balance(&maker),before,"base transfer must roll back on quote failure");
        assert_eq!(q.balance(&maker),500*SCALE);
        assert!(!c.is_settled(&fill.match_id));
    }
    #[test]
    fn unauthorised_bilateral_settlement_rejected_without_wallet_signatures(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let fill=terms(&e,&maker,&taker,&base,&quote,31,0);
        let b=token::TokenClient::new(&e,&base);
        let before=b.balance(&maker);
        e.set_auths(&[]); // remove mock_all_auths; no party signer
        assert!(c.try_settle(&fill).is_err());
        assert_eq!(b.balance(&maker),before);
        assert!(!c.is_settled(&fill.match_id));
    }
    #[test]
    fn unauthorised_admin_cannot_change_pause_or_assets(){
        let (e,id,_,_,_,base,_)=setup();
        let c=SpotSettlementClient::new(&e,&id);
        e.set_auths(&[]);
        assert!(c.try_set_pause(&false).is_err());
        assert!(c.try_set_asset(&base,&false).is_err());
        assert!(c.paused());
        assert!(c.allowed(&base));
    }
    #[test]
    fn receipts_remain_readable_when_paused_and_keeper_can_extend_ttl(){
        let (e,id,_,maker,taker,base,quote)=setup();
        open(&e,&id);
        let c=SpotSettlementClient::new(&e,&id);
        let fill=terms(&e,&maker,&taker,&base,&quote,33,0);
        c.settle(&fill);
        c.set_pause(&true);
        c.keepalive(&fill.match_id,&base,&quote);
        assert!(c.receipt(&fill.match_id).is_some());
        assert!(c.is_settled(&fill.match_id));
    }
