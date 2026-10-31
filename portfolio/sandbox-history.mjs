/**
 * HOXO SS M18 — read-only signed sandbox order/trade/position history.
 * Inputs are already authenticated and hash-chain checked by
 * SignedOrderJournal.open(). No simulation appears as on-chain holdings.
 */
import {formatUnits,SANDBOX_MARKETS} from "../matching/core.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";
const MAX_LIMIT=100;
function page(items,{limit=25,cursor=0}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_LIMIT||
     !Number.isSafeInteger(cursor)||cursor<0||cursor>100_000)throw Error("Invalid history pagination");
  const result=items.slice(cursor,cursor+limit);
  return {items:result,nextCursor:cursor+result.length<items.length?cursor+result.length:null,
    complete:cursor+result.length>=items.length};
}
const unavailable=(reason)=>Object.freeze({
  status:"UNAVAILABLE",reason,records:[],amountE7:null,
});
export function projectSandboxHistory(state,owner,{limit=25,cursor=0}={}){
  if(!isStellarGAddress(owner))throw Error("Invalid sandbox portfolio owner");
  if(!state||!(state.orders instanceof Map)||!(state.positions instanceof Map)||
     !Array.isArray(state.fills)||!Array.isArray(state.transitions))throw Error("Invalid sandbox journal state");
  const orders=[...state.orders.values(),...state.conditionals.values()]
    .filter(o=>o.owner===owner)
    .map(o=>({
      id:o.id,marketId:o.marketId,side:o.side,
      type:o.orderType||"legacy_limit",
      status:state.conditionals.has(o.id)?"PENDING_TRIGGER":"RESTING",
      remainingE7:formatUnits(o.remainingUnits),expiresAtMs:o.expiresAtMs,
      provenance:"SIGNED_OFFCHAIN_JOURNAL_ONLY",settlement:"NOT_SETTLED",
    }))
    .sort((a,b)=>a.id.localeCompare(b.id));
  const transitions=state.transitions
    .filter(t=>t.orderId.startsWith(owner+":"))
    .map(t=>({...t,provenance:"SIGNED_OFFCHAIN_JOURNAL_ONLY"}));
  const fills=state.fills.filter(f=>f.maker===owner||f.taker===owner)
    .map(f=>({...f,simulated:true,settlement:"NOT_SETTLED",
      onchain:false,provenance:"M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN"}));
  const simulatedPositions=[];
  for(const marketId of SANDBOX_MARKETS.filter(id=>id.endsWith("-perp"))){
    const signed=state.positions.get(owner+"|"+marketId)||0n;
    if(signed!==0n)simulatedPositions.push({
      marketId,side:signed>0n?"LONG":"SHORT",
      quantityE7:formatUnits(signed<0n?-signed:signed),
      entryPriceE7:null,realizedPnlE7:null,unrealizedPnlE7:null,
      source:"LOCAL_UNSETTLED_FILLS",onchain:false,
    });
  }
  return Object.freeze({
    owner,network:"STELLAR_TESTNET_REFERENCE_ONLY",
    sequence:state.sequence,
    orderHistory:page(transitions,{limit,cursor}),
    simulatedFills:page(fills,{limit,cursor}),
    openSandboxOrders:orders,
    simulatedPositions,
    // Real accounting sections deliberately exclude mock values.
    positions:unavailable("NO_VERIFIED_PERP_CONTRACT_STATE"),
    pnl:unavailable("NO_VERIFIED_SETTLEMENT_OR_COST_BASIS"),
    funding:unavailable("NO_AUTHENTICATED_FUNDING_EVENTS"),
    interest:unavailable("NO_VERIFIED_LENDING_CONTRACT_STATE"),
    transfers:unavailable("USE_INDEPENDENT_STELLAR_HORIZON_WALLET_ACTIVITY"),
    realTradeHistory:unavailable("NO_ONCHAIN_HOXO_TRADE_RECEIPTS"),
    completeness:"LOCAL_SIGNED_JOURNAL_REPLAY_ONLY",
    executionPermitted:false,tradingEnabled:false,
  });
}
