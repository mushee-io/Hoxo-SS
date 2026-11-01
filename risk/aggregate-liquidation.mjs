import { previewDebtWaterfall, MAX_I128 } from "./cross-product-waterfall.mjs";

/**
 * Read-only market-wide liquidation loss budget. A SINGLE shared insurance
 * balance is depleted across positions; it cannot be reused for every loan.
 * Inputs are hypothetical e7 amounts, never authenticated chain balances.
 * This function grants no permission to seize funds or trade.
 */
export function previewAggregateLiquidations(positions, insuranceAvailableE7) {
  if (!Array.isArray(positions) || positions.length > 64)
    throw new TypeError("positions must be an array of at most 64 entries");
  if (typeof insuranceAvailableE7 !== "bigint" ||
      insuranceAvailableE7 < 0n || insuranceAvailableE7 > MAX_I128)
    throw new TypeError("insuranceAvailableE7 must be a non-negative i128 bigint");
  let remaining = insuranceAvailableE7;
  const seen = new Set();
  const totals = {
    debtE7: 0n, realisedCollateralE7: 0n, liquidationCostsPaidE7: 0n,
    liquidationCostsUnfundedE7: 0n, debtPaidFromCollateralE7: 0n,
    insuranceUsedE7: 0n, lenderShortfallE7: 0n, borrowerSurplusE7: 0n
  };
  const validated = [];
  for (const position of positions) {
    if (position === null || typeof position !== "object" ||
        Array.isArray(position) || Object.getPrototypeOf(position) !== Object.prototype)
      throw new TypeError("position must be a plain record");
    const descriptors = Object.getOwnPropertyDescriptors(position);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = ["id", "accruedDebtE7", "realisedSeizedCollateralE7", "liquidationCostE7"];
    if (keys.some(k => typeof k !== "string" || !allowed.includes(k)) ||
        !allowed.every(k => Object.hasOwn(descriptors, k) && "value" in descriptors[k]))
      throw new TypeError("position must contain only the four required data properties");
    const { id, accruedDebtE7, realisedSeizedCollateralE7, liquidationCostE7 } =
      Object.fromEntries(allowed.map(k => [k, descriptors[k].value]));
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || seen.has(id))
      throw new TypeError("position id must be unique and ASCII-safe");
    seen.add(id);
    validated.push({ id, accruedDebtE7, realisedSeizedCollateralE7, liquidationCostE7 });
  }
  // Canonical bytewise ASCII order prevents caller-controlled batch permutations
  // from changing which debt receives the limited insurance allocation.
  validated.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const results = [];
  for (const { id, accruedDebtE7, realisedSeizedCollateralE7, liquidationCostE7 } of validated) {
    const r = previewDebtWaterfall({
      accruedDebtE7, realisedSeizedCollateralE7, liquidationCostE7,
      insuranceAvailableE7: remaining
    });
    remaining = r.insuranceRemainingE7;
    for (const [field, value] of [
      ["debtE7", r.accruedDebtE7],
      ["realisedCollateralE7", r.realisedSeizedCollateralE7],
      ["liquidationCostsPaidE7", r.liquidationCostPaidE7],
      ["liquidationCostsUnfundedE7", r.liquidationCostUnfundedE7],
      ["debtPaidFromCollateralE7", r.debtPaidFromCollateralE7],
      ["insuranceUsedE7", r.insuranceUsedE7],
      ["lenderShortfallE7", r.lenderShortfallE7],
      ["borrowerSurplusE7", r.borrowerSurplusE7]
    ]) {
      const next = totals[field] + value;
      if (next > MAX_I128)
        throw new RangeError(`aggregate ${field} exceeds Soroban signed i128 maximum`);
      totals[field] = next;
    }
    results.push(Object.freeze({ id, ...r }));
  }
  if (totals.insuranceUsedE7 + remaining !== insuranceAvailableE7 ||
      totals.debtPaidFromCollateralE7 + totals.insuranceUsedE7 + totals.lenderShortfallE7 !== totals.debtE7 ||
      totals.liquidationCostsPaidE7 + totals.debtPaidFromCollateralE7 + totals.borrowerSurplusE7 !== totals.realisedCollateralE7)
    throw new Error("aggregate liquidation conservation failure");
  return Object.freeze({
    positions: Object.freeze(results),
    totals: Object.freeze(totals),
    insuranceRemainingE7: remaining,
    insuranceInitiallyAvailableE7: insuranceAvailableE7,
    ordering: "canonical ASCII position-id ascending; not an approved keeper eligibility or fairness policy",
    executable: false, riskApproved: false, tradingEnabled: false
  });
}
