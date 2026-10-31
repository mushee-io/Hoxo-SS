/**
 * Hoxo-SS offline reference risk engine.
 *
 * Monetary quantities use signed decimal strings, up to eight decimals.
 * All intermediate USD values are integer 1e8 units. No floating-point
 * arithmetic, I/O, wallet signing, oracle fetching or trading takes place here.
 *
 * NOT suitable as contract-side authorization; the on-chain risk engine
 * must independently enforce the same or stricter invariants.
 */
export const SCALE = 100_000_000n;
const BPS = 10_000n;

export const REFERENCE_POLICY = Object.freeze({
  debtInitialReserveBps: 2_000,
  debtMaintenanceReserveBps: 1_000,
});

export function parseFixed(value, { signed = false } = {}) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d{1,8})?$/.test(value)) {
    throw new TypeError("Fixed-point input must be a decimal string with at most 8 fractional digits");
  }
  if (!signed && value.startsWith("-")) throw new RangeError("Negative amount not allowed");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fractional = ""] = unsigned.split(".");
  const n = BigInt(whole) * SCALE + BigInt(fractional.padEnd(8, "0"));
  return negative ? -n : n;
}

export function formatFixed(value) {
  if (typeof value !== "bigint") throw new TypeError("Expected bigint");
  const negative = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / SCALE;
  const fractional = (absolute % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return negative + whole.toString() + (fractional ? "." + fractional : "");
}

function floorDiv(num, den) {
  if (den <= 0n) throw new RangeError("Divisor must be positive");
  const q = num / den;
  return num < 0n && num % den !== 0n ? q - 1n : q;
}

function ceilDivPositive(num, den) {
  if (num < 0n || den <= 0n) throw new RangeError("Expected positive division");
  return (num + den - 1n) / den;
}

function bps(value, field, { min = 0, max = 10000 } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(field + " must be an integer between " + min + " and " + max);
  }
  return BigInt(value);
}

function priceData(row, nowSec, maxOracleAgeSec) {
  if (!Number.isSafeInteger(row.priceTimestampSec) ||
      row.priceTimestampSec > nowSec ||
      nowSec - row.priceTimestampSec > maxOracleAgeSec) {
    throw new RangeError("Missing, future or stale oracle price");
  }
  const price = parseFixed(row.priceUsd);
  if (price <= 0n) throw new RangeError("Oracle price must be positive");
  return price;
}

function positiveAmount(row, field) {
  const value = parseFixed(row[field]);
  if (value <= 0n) throw new RangeError(field + " must be positive");
  return value;
}

function uniqueRows(rows, key, kind) {
  if (!Array.isArray(rows)) throw new TypeError(kind + " must be an array");
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row[key] !== "string" || !row[key].trim() || seen.has(row[key])) {
      throw new RangeError("Invalid or duplicate " + kind + " identifier");
    }
    seen.add(row[key]);
  }
}

/**
 * Inputs:
 * {nowSec, maxOracleAgeSec, collateral, debts, perps}
 *
 * collateral: {asset,amount,priceUsd,collateralFactorBps,priceTimestampSec}
 * debts: {asset,amount,priceUsd,priceTimestampSec}
 * perps: {market,baseSize,entryPriceUsd,priceUsd,
 *         initialMarginBps,maintenanceMarginBps,priceTimestampSec}
 *
 * A supplied receipt token MUST replace (not duplicate) its underlying balance.
 * Callers must provide only authenticated, canonical on-chain balances/positions.
 */
export function evaluateAccount(account) {
  if (!account || !Number.isSafeInteger(account.nowSec) || account.nowSec < 0 ||
      !Number.isSafeInteger(account.maxOracleAgeSec) ||
      account.maxOracleAgeSec <= 0 || account.maxOracleAgeSec > 86_400) {
    throw new RangeError("Invalid evaluation time or oracle freshness limit");
  }
  const { nowSec, maxOracleAgeSec } = account;
  const collateral = account.collateral ?? [];
  const debts = account.debts ?? [];
  const perps = account.perps ?? [];
  uniqueRows(collateral, "asset", "collateral");
  uniqueRows(debts, "asset", "debts");
  uniqueRows(perps, "market", "perps");

  let grossCollateral = 0n;
  let discountedCollateral = 0n;
  let debtUsd = 0n;
  let unrealizedPnl = 0n;
  let perpNotional = 0n;
  let perpInitial = 0n;
  let perpMaintenance = 0n;

  for (const item of collateral) {
    const amount = positiveAmount(item, "amount");
    const price = priceData(item, nowSec, maxOracleAgeSec);
    const factor = bps(item.collateralFactorBps, "collateralFactorBps");
    const value = floorDiv(amount * price, SCALE);
    grossCollateral += value;
    discountedCollateral += floorDiv(value * factor, BPS);
  }

  for (const item of debts) {
    const amount = positiveAmount(item, "amount");
    const price = priceData(item, nowSec, maxOracleAgeSec);
    debtUsd += ceilDivPositive(amount * price, SCALE);
  }

  for (const item of perps) {
    const size = parseFixed(item.baseSize, { signed: true });
    if (size === 0n) throw new RangeError("Perp baseSize must be nonzero");
    const mark = priceData(item, nowSec, maxOracleAgeSec);
    const entry = parseFixed(item.entryPriceUsd);
    if (entry <= 0n) throw new RangeError("Perp entry price must be positive");
    const init = bps(item.initialMarginBps, "initialMarginBps", { min: 1 });
    const maint = bps(item.maintenanceMarginBps, "maintenanceMarginBps", { min: 1 });
    if (init < maint) throw new RangeError("Initial margin must be >= maintenance margin");
    const absoluteSize = size < 0n ? -size : size;
    const notional = ceilDivPositive(absoluteSize * mark, SCALE);
    perpNotional += notional;
    perpInitial += ceilDivPositive(notional * init, BPS);
    perpMaintenance += ceilDivPositive(notional * maint, BPS);
    // Round losses down (more negative) and gains down (less positive).
    unrealizedPnl += floorDiv(size * (mark - entry), SCALE);
  }

  const debtInitialReserve = ceilDivPositive(
    debtUsd * BigInt(REFERENCE_POLICY.debtInitialReserveBps), BPS);
  const debtMaintenanceReserve = ceilDivPositive(
    debtUsd * BigInt(REFERENCE_POLICY.debtMaintenanceReserveBps), BPS);
  const initialRequired = perpInitial + debtInitialReserve;
  const maintenanceRequired = perpMaintenance + debtMaintenanceReserve;
  const equity = discountedCollateral - debtUsd + unrealizedPnl;
  const availableMargin = equity - initialRequired;
  const healthFactorBps = maintenanceRequired === 0n
    ? null : floorDiv(equity * BPS, maintenanceRequired).toString();
  const status = equity < 0n || (maintenanceRequired > 0n && equity < maintenanceRequired)
    ? "liquidatable"
    : equity < initialRequired
      ? "initial-margin-breach"
      : "healthy";

  return {
    grossCollateralUsd: formatFixed(grossCollateral),
    adjustedCollateralUsd: formatFixed(discountedCollateral),
    debtUsd: formatFixed(debtUsd),
    perpNotionalUsd: formatFixed(perpNotional),
    unrealizedPnlUsd: formatFixed(unrealizedPnl),
    equityUsd: formatFixed(equity),
    initialRequirementUsd: formatFixed(initialRequired),
    maintenanceRequirementUsd: formatFixed(maintenanceRequired),
    availableMarginUsd: formatFixed(availableMargin),
    healthFactorBps,
    status,
  };
}

/**
 * Reference-only withdrawal preview. Contract must repeat checks against
 * authenticated balances, fresh prices and current positions atomically.
 */
export function previewWithdrawal(account, asset, amount) {
  const withdrawal = parseFixed(amount);
  if (withdrawal <= 0n) throw new RangeError("Withdrawal amount must be positive");
  const rows = account?.collateral ?? [];
  const holding = rows.find((item) => item.asset === asset);
  if (!holding) throw new RangeError("Collateral asset not found");
  const current = parseFixed(holding.amount);
  if (withdrawal > current) return { allowed: false, reason: "insufficient-balance" };
  // First validate the original input as well: missing or stale market
  // data must never disappear merely because the position is removed.
  evaluateAccount(account);
  const next = {
    ...account,
    collateral: rows
      .filter((item) => item.asset !== asset)
      .concat(current === withdrawal ? [] : [{ ...holding, amount: formatFixed(current - withdrawal) }]),
  };
  const post = evaluateAccount(next);
  const allowed = post.status === "healthy";
  return {
    allowed,
    reason: allowed ? "ok" : "insufficient-margin",
    postWithdrawal: post,
  };
}

/**
 * Reference-only pretrade stress preview: caller supplies the COMPLETE
 * post-trade position set (not an additive delta) so risk cannot be
 * understated by silently excluding existing positions.
 */
export function previewPerpPositions(account, completePostTradePositions) {
  const before = evaluateAccount(account);
  const after = evaluateAccount({ ...account, perps: completePostTradePositions });
  return {
    allowed: after.status === "healthy",
    reason: after.status === "healthy" ? "ok" : "insufficient-margin",
    before,
    after,
  };
}
