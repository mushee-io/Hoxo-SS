/**
 * HOXO SS M8 deterministic, OFF-CHAIN, TESTNET-SANDBOX price/time matching.
 * This engine has NO token custody, no on-chain settlement, no margin credit
 * and NO permissions to trade on Stellar. Every matched fill is simulated.
 */
import { canonicalPayload } from "./auth.mjs";

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
  };
}
export function emptyBook() {
  return {sequence: 0, lastMs: 0, orders: new Map(), seenIds: new Set(), nonces: new Map(), fills: []};
}
function assertCommand(command, atMs, state) {
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
function matchIncoming(state, incoming, seq) {
  let left = incoming.remainingUnits;
  const fills = [];
  for (const maker of eligibleMakers(state, incoming)) {
    if (left === 0n) break;
    // Strict fail-closed: reject the ENTIRE command if any crossing trade would self-match,
    // including cases where other owners would have matched first.
    if (maker.owner === incoming.owner) fail("Self-trade prevention: incoming order crosses own resting order");
    const amount = left < maker.remainingUnits ? left : maker.remainingUnits;
    fills.push({
      id: seq + ":" + fills.length,
      marketId: incoming.marketId,
      makerOrderId: maker.id,
      takerOrderId: incoming.id,
      maker: maker.owner,
      taker: incoming.owner,
      priceE7: maker.priceE7, // price-time priority: maker/resting price
      quantityE7: formatUnits(amount),
      settlement: "NOT_SETTLED",
      simulated: true,
    });
    left -= amount;
  }
  // All preflight checks passed; mutate matching maker resting orders.
  for (const fill of fills) {
    const maker = state.orders.get(fill.makerOrderId);
    maker.remainingUnits -= decimalUnits(fill.quantityE7);
    if (maker.remainingUnits === 0n) state.orders.delete(maker.id);
  }
  if (left > 0n) state.orders.set(incoming.id, {...incoming, remainingUnits: left});
  return fills;
}
function expireOrders(state, atMs) {
  const expired = [];
  for (const order of state.orders.values()) {
    if (order.expiresAtMs <= atMs) { state.orders.delete(order.id); expired.push(order.id); }
  }
  return expired.sort();
}
export function projectCommand(previous, command, atMs) {
  if (!previous || !(previous.orders instanceof Map)) fail("Invalid matching state");
  // Validation against original state; no failed command may expire orders or consume nonce.
  assertCommand(command, atMs, previous);
  const state = cloneState(previous);
  const seq = state.sequence + 1;
  const expiredIds = expireOrders(state, atMs);
  const prior = ["cancel", "replace"].includes(command.type) ? state.orders.get(command.orderId) : null;
  if (["cancel", "replace"].includes(command.type) && !prior) fail("Target order expired before cancellation/replacement");
  let orderId = null, fills = [];
  if (command.type === "cancel") {
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
    fills = matchIncoming(state, incoming, seq);
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
export function orderById(state, orderId) {
  const o = state.orders.get(orderId);
  return o ? {id:o.id,owner:o.owner,marketId:o.marketId,side:o.side,
    priceE7:o.priceE7,remainingE7:formatUnits(o.remainingUnits),sequence:o.sequence,
    expiresAtMs:o.expiresAtMs} : null;
}
