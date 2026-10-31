/**
 * M9 bridge PREVIEW: represent a simulated M8 matched fill as potential
 * bilateral Soroban DvP terms. This creates NO valid wallet authorizations,
 * invokes NO RPC method, and NEVER returns an executable order.
 */
import {createHash} from "node:crypto";
import {decimalUnits,formatUnits} from "./core.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {isStellarContractId,validateRegistry} from "../infra/registry.mjs";

const SCALE=10_000_000n;
const MAX_AMOUNT=1_000_000_000_000_000n;
const hash=(domain,value)=>createHash("sha256").update(domain+"\n"+value).digest("hex");
const blocked=(reason,terms=null)=>({
  state:"BLOCKED",
  reason,
  terms,
  walletAuthorisationsRequired:2,
  executionPermitted:false,
  settlement:"NOT_SETTLED",
  onchain:false
});
function assertFill(fill){
  if(!fill||fill.simulated!==true||fill.settlement!=="NOT_SETTLED"||
    typeof fill.id!=="string"||!fill.id||
    typeof fill.marketId!=="string"||!fill.marketId.endsWith("-spot")||
    typeof fill.makerOrderId!=="string"||typeof fill.takerOrderId!=="string"||
    !isStellarGAddress(fill.maker)||!isStellarGAddress(fill.taker)||
    fill.maker===fill.taker||
    !["buy","sell"].includes(fill.makerSide)||
    fill.takerSide===(fill.makerSide)||
    !["buy","sell"].includes(fill.takerSide))throw Error("Invalid M8 spot matched fill");
  if(fill.makerLimitE7!==fill.priceE7)throw Error("M8 maker fill price is inconsistent");
}
export function settlementPreview(fill,{registry,tokenPair=null,expiryLedger=null}={}){
  assertFill(fill);
  const base=decimalUnits(fill.quantityE7);
  const price=decimalUnits(fill.priceE7);
  const makerLimit=decimalUnits(fill.makerLimitE7);
  const takerLimit=decimalUnits(fill.takerLimitE7);
  const quote=(base*price+SCALE-1n)/SCALE;
  if(base>MAX_AMOUNT||quote<=0n||quote>MAX_AMOUNT)
    return blocked("Fill exceeds M9 token amount limits.");
  const effective=quote*SCALE, makerBound=base*makerLimit, takerBound=base*takerLimit;
  if(fill.makerSide==="sell"?(effective<makerBound||effective>takerBound):
    (effective>makerBound||effective<takerBound)){
    return blocked("7-decimal rounding violates one side's limit price.");
  }
  // A plan may identify deterministic byte identifiers, but does not
  // convert prior M8 signatures into Stellar spending authorizations.
  const idData=[
    "Test SDF Network ; September 2015", fill.id,fill.marketId,
    fill.makerOrderId,fill.takerOrderId,fill.maker,fill.taker,
    fill.makerSide,fill.quantityE7,fill.priceE7
  ].join("|");
  const terms={
    match_id:hash("HOXO-M9-MATCH-V1",idData),
    maker_order_id:hash("HOXO-M9-ORDER-V1",fill.makerOrderId),
    taker_order_id:hash("HOXO-M9-ORDER-V1",fill.takerOrderId),
    maker:fill.maker,taker:fill.taker,
    market_id:fill.marketId,
    maker_side:fill.makerSide==="sell"?0:1,
    base_amount:formatUnits(base),quote_amount:formatUnits(quote),
    maker_limit_e7:fill.makerLimitE7,taker_limit_e7:fill.takerLimitE7,
    base_token:null,quote_token:null,expires_at_ledger:null
  };
  if(!registry)return blocked("No Testnet contract registry.",terms);
  const result=validateRegistry(registry);
  const settlement=result.statuses.find(x=>x.role==="spot-settlement");
  if(settlement?.status!=="candidate"||!isStellarContractId(settlement.contractId))
    return blocked("No verified M9 spot contract deployment; Testnet registry remains planned.",terms);
  if(!tokenPair||!isStellarContractId(tokenPair.base_token)||
      !isStellarContractId(tokenPair.quote_token)||
      tokenPair.base_token===tokenPair.quote_token)
    return blocked("Approved 7-decimal Stellar Testnet token-contract addresses are missing.",terms);
  if(!Number.isSafeInteger(expiryLedger)||expiryLedger<=0)
    return blocked("Fresh Stellar Testnet ledger deadline has not been agreed.",terms);
  terms.base_token=tokenPair.base_token;
  terms.quote_token=tokenPair.quote_token;
  terms.expires_at_ledger=expiryLedger;
  return blocked("Two independent wallets must authorise the exact contract invocation. No signed settlement transaction was created.",terms);
}
