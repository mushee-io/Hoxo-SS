/**
 * HOXO SS M17 advanced orders — non-executable TESTNET SANDBOX ONLY.
 *
 * Price ticks are signed by an explicitly configured sandbox operator and
 * never represent a deployed M5 oracle. "Positions" derived from simulated
 * fills do not establish real collateral, authority or live reduce-only safety.
 */
const SCALE=10_000_000n;
const MAX_UNITS=1_000_000_000_000_000_000n;
function decimalUnits(value){
  if(typeof value!=="string" || !/^(0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value))
    throw Error("Expected positive fixed-point decimal (up to 7 places)");
  const [whole,fraction=""]=value.split(".");
  const amount=BigInt(whole)*SCALE+BigInt(fraction.padEnd(7,"0"));
  if(amount<=0n||amount>MAX_UNITS)throw Error("Amount outside sandbox limits");
  return amount;
}

export const CONDITIONAL_TYPES = Object.freeze([
  "stop_loss_market","stop_loss_limit","take_profit_market","take_profit_limit",
]);
export const ADVANCED_TYPES = Object.freeze(["limit","market",...CONDITIONAL_TYPES]);
const isMarket = type => type === "market" || type.endsWith("_market");
export const isConditional = type => CONDITIONAL_TYPES.includes(type);
export const isMarketType = isMarket;
const fail = message => { throw Error(message); };
export const SANDBOX_TICK_MAX_AGE_MS = 120_000;

function zeroOrPositive(value) {
  if (value === "0") return 0n;
  return decimalUnits(value);
}
export function validateAdvancedOrder(command) {
  const type = command.orderType;
  if (!ADVANCED_TYPES.includes(type)) fail("Unsupported M17 advanced order type");
  if (typeof command.reduceOnly !== "boolean") fail("reduceOnly must be a boolean");
  if (typeof command.priceE7 !== "string" ||
      typeof command.triggerPriceE7 !== "string" ||
      typeof command.protectionPriceE7 !== "string") fail("All M17 prices must be decimal strings");
  const trigger = zeroOrPositive(command.triggerPriceE7);
  const limit = zeroOrPositive(command.priceE7);
  const protection = zeroOrPositive(command.protectionPriceE7);
  decimalUnits(command.quantityE7);
  if (isConditional(type)) {
    if (!command.marketId.endsWith("-perp") || !command.reduceOnly) {
      fail("TP/SL requires simulated perp exposure and reduceOnly=true");
    }
    if (trigger === 0n) fail("Conditional trigger price required");
  } else if (trigger !== 0n) fail("Non-conditional orders cannot carry a trigger price");
  if (isMarket(type)) {
    if (limit !== 0n || protection === 0n) fail("Market execution requires a price-protection bound, not a limit price");
  } else if (protection !== 0n || limit === 0n) {
    fail("Limit execution requires limit price and zero protection price");
  }
  return { conditional: isConditional(type), market: isMarket(type) };
}

export function triggerSatisfied(order, markPriceE7) {
  const mark = decimalUnits(markPriceE7);
  const trigger = decimalUnits(order.triggerPriceE7);
  if (order.orderType.startsWith("stop_loss_")) {
    return order.side === "sell" ? mark <= trigger : mark >= trigger;
  }
  if (order.orderType.startsWith("take_profit_")) {
    return order.side === "sell" ? mark >= trigger : mark <= trigger;
  }
  return false;
}

export function validateSandboxTick(command, atMs, previousTick, oracleSigner) {
  if (!oracleSigner || command.owner !== oracleSigner) fail("A separately configured sandbox price operator must sign ticks");
  if (!Number.isSafeInteger(command.observedAtMs) ||
      command.observedAtMs > atMs ||
      atMs - command.observedAtMs > SANDBOX_TICK_MAX_AGE_MS) {
    fail("Stale or future signed sandbox tick");
  }
  decimalUnits(command.markPriceE7);
  if (previousTick && command.observedAtMs <= previousTick.observedAtMs) {
    fail("Replayed or non-monotonic sandbox tick timestamp");
  }
}

export function simulatedReductionAvailable(position, side) {
  return side === "sell" ? (position > 0n ? position : 0n) : (position < 0n ? -position : 0n);
}
