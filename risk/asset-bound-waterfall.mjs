import { previewDebtWaterfall } from "./cross-product-waterfall.mjs";

const TOKEN_FIELDS = [
  "canonicalTokenContractId", "debtTokenContractId",
  "collateralProceedsTokenContractId", "insuranceTokenContractId",
  "liquidationCostTokenContractId",
];
const AMOUNT_FIELDS = [
  "accruedDebtE7", "realisedSeizedCollateralE7",
  "insuranceAvailableE7", "liquidationCostE7",
];
const ALLOWED_FIELDS = new Set([...TOKEN_FIELDS, ...AMOUNT_FIELDS]);

/**
 * Read-only preflight, NOT authenticated state or transaction authorisation.
 * Fail closed on unexpected keys and inherited fields: typos, stale callers,
 * and extra risk-related inputs must not silently disappear from a preview.
 */
export function previewAssetBoundWaterfall(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("waterfall input must be a plain record");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("waterfall input must be a plain record");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !ALLOWED_FIELDS.has(key)) {
      throw new TypeError("unexpected waterfall input field: " + String(key));
    }
  }
  for (const key of [...TOKEN_FIELDS, ...AMOUNT_FIELDS.slice(0, 3)]) {
    if (!Object.hasOwn(input, key)) {
      throw new TypeError("missing waterfall input field: " + key);
    }
  }
  const ids = Object.fromEntries(TOKEN_FIELDS.map(key => [key, input[key]]));
  for (const [name, value] of Object.entries(ids)) {
    if (typeof value !== "string" || !/^C[A-Z2-7]{55}$/.test(value)) {
      throw new TypeError(name + " must be an explicit Stellar contract identifier");
    }
  }
  for (const [name, value] of Object.entries(ids)) {
    if (value !== ids.canonicalTokenContractId) {
      throw new Error(name + " does not match the canonical settlement token");
    }
  }
  const amounts = Object.fromEntries(
    AMOUNT_FIELDS.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])
  );
  const result = previewDebtWaterfall(amounts);
  return Object.freeze({
    ...result,
    canonicalTokenContractId: ids.canonicalTokenContractId,
    provenanceVerified: false,
    executable: false,
    riskApproved: false,
  });
}
