/**
 * HOXO SS M8 deterministic, OFF-CHAIN, TESTNET-SANDBOX price/time matching.
 * This engine has NO token custody, no on-chain settlement, no margin credit
 * and NO permissions to trade on Stellar. Every matched fill is simulated.
 */
import { canonicalPayload } from "./auth.mjs";
import { validateAdvancedOrder, isConditional, isMarketType, triggerSatisfied, validateSandboxTick, simulatedReductionAvailable } from "./advanced.mjs";

export const SANDBOX_MARKETS = Object.freeze([
  "xlm-usdc-spot", "btc-usdc-spot", "xlm-usdc-perp", "btc-usdc-perp", "eth-usdc-perp",
]);
const SCALE = 10_000_000n;
const MAX_OPEN = 5_000;
const MAX_QTY_UNITS = 1_000_000_000_000_000_000n;
const MAX_LIFETIME_MS = 7 * 24 * 3600 * 1000;
const CLIENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^G[A-Z2-7]{55}:[A-Za-z0-9_-]{1,64}$/;
const fail = (message) => { throw new Error(message); };

export function decimalUnits(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value)) fail("Expected positive fixed-point decimal (up to 7 places)");
  const [whole, fractional = ""] = value.split(".");
  const units = BigInt(whole) * SCALE + BigInt(fractional.padEnd(7, "0"));
  if (units <= 0n || units > MAX_QTY_UNITS) fail("Amount outside sandbox limits");
  return units;
}
export function formatUnits(value) {
  if (typeof value !== "bigint" || value < 0n) fail("Invalid quantity");
  const rem = (value % SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return (value / SCALE).toString() + (rem ? "." + rem : "");
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function compareResting(a, b) {
  if (a.side !== b.side) fail("Resting side mismatch");
  const ap = decimalUnits(a.priceE7), bp = decimalUnits(b.priceE7);
  const price = a.side === "buy" ? cmp(bp, ap) : cmp(ap, bp);
  return price || a.sequence - b.sequence;
}
function crosses(incoming, resting) {
  const incomingPrice = decimalUnits(incoming.priceE7);
  const restingPrice = decimalUnits(resting.priceE7);
  return incoming.side === "buy" ? incomingPrice >= restingPrice : incomingPrice <= restingPrice;
}
function assertInvariant(state) {
  if (state.orders.size > MAX_OPEN) fail("Open-order cap exceeded");
  for (const order of state.orders.values()) {
    if (order.remainingUnits <= 0n || order.remainingUnits > decimalUnits(order.quantityE7)) fail("Invalid resting quantity");
    if (!SANDBOX_MARKETS.includes(order.marketId)) fail("Invalid resting market");
  }
}
function cloneState(state) {
  return {
    sequence: state.sequence,
    lastMs: state.lastMs,
    orders: new Map([...state.orders].map(([k, v]) => [k, { ...v }])),
    seenIds: new Set(state.seenIds),
    nonces: new Map(state.nonces),
    fills: [...state.fills],
    conditionals: new Map([...state.conditionals].map(([k,v])=>[k,{...v}])),
    positions: new Map(state.positions),
    markTicks: new Map([...state.markTicks].map(([k,v])=>[k,{...v}])),
    transitions: [...state.transitions],
  };
}
export function emptyBook() {
  return {sequence: 0, lastMs: 0, orders: new Map(), conditionals: new Map(),
    seenIds: new Set(), nonces: new Map(), fills: [], positions: new Map(),
    markTicks: new Map(), transitions: []};
}
function assertCommand(command, atMs, state, {tickSigner=null} = {}) {
  canonicalPayload(command);
  if (!Number.isSafeInteger(atMs) || atMs < state.lastMs || atMs < 1) fail("Non-monotonic engine time");
  if ((state.nonces.get(command.owner) || 0) >= command.nonce) fail("Replayed or non-monotonic owner nonce");
  if (["place", "replace"].includes(command.type)) {
    if (!SANDBOX_MARKETS.includes(command.marketId)) fail("Market is not in the non-executable reference catalog");
    if (!["buy", "sell"].includes(command.side)) fail("Invalid order side");
    if (!CLIENT_RE.test(command.clientOrderId)) fail("Invalid client order identifier");
    decimalUnits(command.priceE7);
    decimalUnits(command.quantityE7);
    if (!Number.isSafeInteger(command.expiresAtMs) || command.expiresAtMs <= atMs ||
        command.expiresAtMs - atMs > MAX_LIFETIME_MS) fail("Invalid order expiry");
    if (state.seenIds.has(command.owner + ":" + command.clientOrderId)) fail("Duplicate client order ID");
  }
  if (command.type === "advanced_place") {
    if (!SANDBOX_MARKETS.includes(command.marketId)) fail("Invalid M17 reference market");
    if (!["buy","sell"].includes(command.side) || !CLIENT_RE.test(command.clientOrderId)) {
      fail("Invalid M17 side or client order ID");
    }
    validateAdvancedOrder(command);
    if (command.reduceOnly && !command.marketId.endsWith("-perp")) fail("Reduce-only only applies to simulated perps");
    if (!Number.isSafeInteger(command.expiresAtMs) || command.expiresAtMs <= atMs ||
        command.expiresAtMs-atMs>MAX_LIFETIME_MS) fail("Invalid M17 order expiry");
    const id=command.owner+":"+command.clientOrderId;
    if (state.seenIds.has(id)) fail("Duplicate client order ID");
    if (command.reduceOnly) {
      const position=state.positions.get(command.owner+"|"+command.marketId)||0n;
      const free=simulatedReductionAvailable(position,command.side);
      const reserved=[...state.orders.values(),...state.conditionals.values()]
        .filter(x=>x.advanced&&x.reduceOnly&&x.owner===command.owner&&
          x.marketId===command.marketId&&x.side===command.side)
        .reduce((sum,x)=>sum+x.remainingUnits,0n);
      if (free<=reserved || decimalUnits(command.quantityE7)>free-reserved) {
        fail("Reduce-only exceeds uncommitted SIMULATED position");
      }
    }
  }
  if (command.type === "advanced_cancel") {
    if (typeof command.orderId !== "string" || !ID_RE.test(command.orderId)) {
      fail("Invalid advanced cancellation ID");
    }
    const prior=state.conditionals.get(command.orderId)||state.orders.get(command.orderId);
    if (!prior?.advanced||prior.owner!==command.owner) fail("Advanced order not found or ownership mismatch");
  }
  if (command.type === "sandbox_tick") {
    if (!SANDBOX_MARKETS.includes(command.marketId) || !command.marketId.endsWith("-perp")) {
      fail("Signed sandbox tick must target a reference perp market");
    }
    validateSandboxTick(command,atMs,state.markTicks.get(command.marketId),tickSigner);
  }
  if (["cancel", "replace"].includes(command.type)) {
    if (typeof command.orderId !== "string" || !ID_RE.test(command.orderId)) fail("Invalid cancellation identifier");
    const prior = state.orders.get(command.orderId);
    if (!prior || prior.owner !== command.owner) fail("Order not found or ownership mismatch");
    if (command.type === "replace" && (prior.marketId !== command.marketId || prior.side !== command.side)) {
      fail("Cannot change market/side during atomic replacement");
    }
  }
}
function eligibleMakers(state, incoming) {
  return [...state.orders.values()].filter(order =>
    order.marketId === incoming.marketId && order.side !== incoming.side && crosses(incoming, order)
  ).sort(compareResting);
}
function transition(state,orderId,from,to,reason,seq,atMs){
  if(state.transitions.length>=200_000)fail("M17 transition history capacity reached");
  state.transitions.push(Object.freeze({
    orderId,from,to,reason,sequence:seq,atMs,
    settlement:"NOT_SETTLED",onchain:false,
  }));
}
function priceLimitFor(order) {
  return order.advanced && isMarketType(order.orderType)
    ? order.protectionPriceE7 : order.priceE7;
}
function liveExposure(state,owner,marketId){
  return state.positions.get(owner+"|"+marketId)||0n;
}
function matchIncoming(state,incoming,seq,atMs,prefix="") {
  let left=incoming.remainingUnits;
  const fills=[];
  const working=new Map(state.positions);
  const getPosition=(owner,market)=>working.get(owner+"|"+market)||0n;
  const apply=(owner,market,side,amount)=>{
    const key=owner+"|"+market;
    const cur=getPosition(owner,market);
    working.set(key,cur+(side==="buy"?amount:-amount));
  };
  for(const maker of eligibleMakers(state,incoming)) {
    if(left===0n)break;
    if(maker.owner===incoming.owner)fail("Self-trade prevention: incoming order crosses own resting order");
    let amount=left<maker.remainingUnits?left:maker.remainingUnits;
    if(maker.reduceOnly)amount=amount<simulatedReductionAvailable(
      getPosition(maker.owner,incoming.marketId),maker.side)?amount:
      simulatedReductionAvailable(getPosition(maker.owner,incoming.marketId),maker.side);
    if(incoming.reduceOnly)amount=amount<simulatedReductionAvailable(
      getPosition(incoming.owner,incoming.marketId),incoming.side)?amount:
      simulatedReductionAvailable(getPosition(incoming.owner,incoming.marketId),incoming.side);
    if(amount===0n)continue;
    fills.push({
      id:prefix ? seq+":"+prefix+":"+fills.length : seq+":"+fills.length,
      marketId:incoming.marketId,makerOrderId:maker.id,takerOrderId:incoming.id,
      maker:maker.owner,taker:incoming.owner,priceE7:maker.priceE7,
      makerSide:maker.side,takerSide:incoming.side,
      makerLimitE7:maker.priceE7,takerLimitE7:incoming.priceE7,
      quantityE7:formatUnits(amount),
      settlement:"NOT_SETTLED",simulated:true,
      ...(maker.advanced||incoming.advanced?{advancedSandbox:true}:{}),
    });
    if(incoming.marketId.endsWith("-perp")){
      apply(maker.owner,incoming.marketId,maker.side,amount);
      apply(incoming.owner,incoming.marketId,incoming.side,amount);
    }
    left-=amount;
  }
  // Preflight complete. Never mutate the original engine state on failure.
  for(const fill of fills){
    const maker=state.orders.get(fill.makerOrderId);
    const before=maker.remainingUnits;
    maker.remainingUnits-=decimalUnits(fill.quantityE7);
    if(maker.remainingUnits===0n)state.orders.delete(maker.id);
    if(maker.advanced){
      transition(state,maker.id,before===decimalUnits(maker.quantityE7)?"RESTING":"PARTIALLY_SIMULATED",
        maker.remainingUnits===0n?"SIMULATED_FILLED":"PARTIALLY_SIMULATED",
        "MATCHED_SANDBOX_ONLY",seq,atMs);
    }
  }
  state.positions=working;
  if(left>0n && !incoming.ioc)state.orders.set(incoming.id,{...incoming,remainingUnits:left});
  return fills;
}
function expireOrders(state,atMs,seq){
  const expired=[];
  for(const order of state.orders.values()){
    if(order.expiresAtMs<=atMs){
      state.orders.delete(order.id);expired.push(order.id);
      if(order.advanced)transition(state,order.id,"RESTING","EXPIRED","EXPIRY",seq,atMs);
    }
  }
  for(const order of state.conditionals.values()){
    if(order.expiresAtMs<=atMs){
      state.conditionals.delete(order.id);expired.push(order.id);
      transition(state,order.id,"PENDING_TRIGGER","EXPIRED","EXPIRY",seq,atMs);
    }
  }
  return expired.sort();
}
export function projectCommand(previous,command,atMs,options={}) {
  if (!previous || !(previous.orders instanceof Map)) fail("Invalid matching state");
  // Validation against original state; no failed command may expire orders or consume nonce.
  assertCommand(command,atMs,previous,options);
  const state = cloneState(previous);
  const seq = state.sequence + 1;
  const expiredIds = expireOrders(state,atMs,seq);
  const prior = ["cancel", "replace"].includes(command.type) ? state.orders.get(command.orderId) : null;
  if (["cancel", "replace"].includes(command.type) && !prior) fail("Target order expired before cancellation/replacement");
  let orderId=null,fills=[];
  if(command.type==="advanced_cancel"){
    orderId=command.orderId;
    const target=state.conditionals.get(orderId)||state.orders.get(orderId);
    if(!target)fail("Advanced order expired before cancellation");
    state.conditionals.delete(orderId);state.orders.delete(orderId);
    transition(state,orderId,target.conditional?"PENDING_TRIGGER":"RESTING",
      "CANCELLED","OWNER_SIGNED_CANCEL",seq,atMs);
  }else if(command.type==="advanced_place"){
    orderId=command.owner+":"+command.clientOrderId;
    const shape=validateAdvancedOrder(command);
    const incoming={
      id:orderId,owner:command.owner,clientOrderId:command.clientOrderId,
      marketId:command.marketId,side:command.side,
      priceE7:shape.market?command.protectionPriceE7:command.priceE7,
      quantityE7:command.quantityE7,remainingUnits:decimalUnits(command.quantityE7),
      triggerPriceE7:command.triggerPriceE7,
      protectionPriceE7:command.protectionPriceE7,
      orderType:command.orderType,reduceOnly:command.reduceOnly,
      advanced:true,conditional:shape.conditional,ioc:shape.market,
      expiresAtMs:command.expiresAtMs,sequence:seq,placedAtMs:atMs,
    };
    state.seenIds.add(orderId);
    if(shape.conditional){
      state.conditionals.set(orderId,incoming);
      transition(state,orderId,"SUBMITTED","PENDING_TRIGGER","SIGNATURE_VERIFIED_SANDBOX",seq,atMs);
    }else{
      fills=matchIncoming(state,incoming,seq,atMs);
      const next=state.orders.get(orderId);
      const filled=fills.reduce((sum,x)=>sum+decimalUnits(x.quantityE7),0n);
      const final=next?(fills.length?"PARTIALLY_SIMULATED":"RESTING"):
        (incoming.ioc?(filled===0n?"IOC_UNFILLED":
          filled<incoming.remainingUnits?"IOC_PARTIAL":"SIMULATED_FILLED"):
          (fills.length?"SIMULATED_FILLED":"IOC_UNFILLED"));
      transition(state,orderId,"SUBMITTED",final,
        "SANDBOX_ORDER_PROCESSING_ONLY",seq,atMs);
    }
    if(state.orders.size+state.conditionals.size>MAX_OPEN)fail("Open-order cap exceeded");
    if(state.fills.length+fills.length>100_000)fail("Sandbox fill history cap exceeded");
    state.fills.push(...fills);
  }else if(command.type==="sandbox_tick"){
    const tick={priceE7:command.markPriceE7,observedAtMs:command.observedAtMs,
      source:"SIGNED_SANDBOX_OPERATOR_NOT_M5_ORACLE"};
    state.markTicks.set(command.marketId,tick);
    const pending=[...state.conditionals.values()]
      .filter(x=>x.marketId===command.marketId&&triggerSatisfied(x,command.markPriceE7))
      .sort((a,b)=>a.sequence-b.sequence);
    for(const [i,order] of pending.entries()){
      state.conditionals.delete(order.id);
      transition(state,order.id,"PENDING_TRIGGER","TRIGGERED",
        "SIGNED_SANDBOX_OPERATOR_TICK",seq,atMs);
      const reducible=simulatedReductionAvailable(
        liveExposure(state,order.owner,order.marketId),order.side);
      if(reducible===0n){
        transition(state,order.id,"TRIGGERED","TRIGGER_REJECTED",
          "NO_SIMULATED_REDUCIBLE_EXPOSURE",seq,atMs);
        continue;
      }
      const incoming={...order,remainingUnits:order.remainingUnits<reducible?
        order.remainingUnits:reducible};
      const got=matchIncoming(state,incoming,seq,atMs,"TRIGGER"+i);
      fills.push(...got);
      const next=state.orders.get(order.id);
      const filled=got.reduce((sum,x)=>sum+decimalUnits(x.quantityE7),0n);
      const status=next?(got.length?"PARTIALLY_SIMULATED":"RESTING"):
        (incoming.ioc?(filled===0n?"IOC_UNFILLED":
          filled<incoming.remainingUnits?"IOC_PARTIAL":"SIMULATED_FILLED"):
          (got.length?"SIMULATED_FILLED":"IOC_UNFILLED"));
      transition(state,order.id,"TRIGGERED",status,
        "SIMULATED_CONDITIONAL_MATCH",seq,atMs);
    }
    if(state.fills.length+fills.length>100_000)fail("Sandbox fill history cap exceeded");
    state.fills.push(...fills);
  }else if (command.type === "cancel") {
    state.orders.delete(command.orderId);
    orderId = command.orderId;
  } else {
    if (command.type === "replace") state.orders.delete(command.orderId);
    orderId = command.owner + ":" + command.clientOrderId;
    const incoming = {
      id: orderId,
      owner: command.owner,
      clientOrderId: command.clientOrderId,
      marketId: command.marketId,
      side: command.side,
      priceE7: command.priceE7,
      quantityE7: command.quantityE7,
      remainingUnits: decimalUnits(command.quantityE7),
      expiresAtMs: command.expiresAtMs,
      sequence: seq,
      placedAtMs: atMs,
    };
    fills = matchIncoming(state, incoming, seq,atMs);
    state.seenIds.add(orderId);
    if (state.orders.size > MAX_OPEN) fail("Open-order cap exceeded");
    if (state.fills.length + fills.length > 100_000) fail("Sandbox fill history cap exceeded");
    state.fills.push(...fills);
  }
  state.nonces.set(command.owner, command.nonce);
  state.sequence = seq;
  state.lastMs = atMs;
  assertInvariant(state);
  return {
    state,
    result: Object.freeze({
      sequence: seq,
      commandType: command.type,
      orderId,
      cancelledOrderId: command.type === "replace" ? command.orderId : command.type === "cancel" ? command.orderId : null,
      expiredIds,
      remainingE7: state.orders.has(orderId) ? formatUnits(state.orders.get(orderId).remainingUnits) : "0",
      pendingConditional:orderId?state.conditionals.has(orderId):false,
      triggeredConditionalIds:command.type==="sandbox_tick"?
        state.transitions.filter(x=>x.sequence===seq&&x.to==="TRIGGERED").map(x=>x.orderId):[],
      simulatedFills: fills,
      settlement: "NOT_SETTLED",
      executionPermitted: false,
    }),
  };
}
export function snapshot(state, marketId, depth = 20) {
  if (!SANDBOX_MARKETS.includes(marketId)) fail("Unrecognised reference market");
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 100) fail("Invalid book depth");
  const orders = [...state.orders.values()].filter(o => o.marketId === marketId);
  const each = side => orders.filter(o => o.side === side).sort(compareResting).slice(0, depth).map(o => ({
    id: o.id, owner: o.owner, sequence: o.sequence, priceE7: o.priceE7,
    remainingE7: formatUnits(o.remainingUnits), expiresAtMs: o.expiresAtMs,
  }));
  return {marketId, sequence: state.sequence, bids: each("buy"), asks: each("sell"),
    provenance:"HOXO-SS M8 LOCAL SANDBOX ONLY — NOT STELLAR ORDER BOOK",
    onchain:false, settleable:false, tradingEnabled:false};
}
export function simulatedPosition(state,owner,marketId){
  if(!SANDBOX_MARKETS.includes(marketId)||!marketId.endsWith("-perp"))fail("Not a reference perp market");
  const signed=state.positions.get(owner+"|"+marketId)||0n;
  return {owner,marketId,side:signed>0n?"LONG":signed<0n?"SHORT":"FLAT",
    quantityE7:formatUnits(signed<0n?-signed:signed),
    source:"M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN",executionPermitted:false};
}
export function advancedOrderById(state,id){
  const order=state.conditionals.get(id)||state.orders.get(id);
  if(!order?.advanced)return null;
  return {id:order.id,owner:order.owner,marketId:order.marketId,
    side:order.side,orderType:order.orderType,reduceOnly:order.reduceOnly,
    quantityE7:order.quantityE7,remainingE7:formatUnits(order.remainingUnits),
    triggerPriceE7:order.triggerPriceE7,
    protectionPriceE7:order.protectionPriceE7,
    status:order.conditional&&state.conditionals.has(id)?"PENDING_TRIGGER":"RESTING",
    expiresAtMs:order.expiresAtMs,onchain:false,settlement:"NOT_SETTLED"};
}
export function orderTransitions(state,id){
  if(typeof id!=="string"||!ID_RE.test(id))fail("Invalid order history identifier");
  return state.transitions.filter(x=>x.orderId===id).map(x=>({...x}));
}
export function orderById(state, orderId) {
  const o = state.orders.get(orderId);
  return o ? {id:o.id,owner:o.owner,marketId:o.marketId,side:o.side,
    priceE7:o.priceE7,remainingE7:formatUnits(o.remainingUnits),sequence:o.sequence,
    expiresAtMs:o.expiresAtMs} : null;
}
