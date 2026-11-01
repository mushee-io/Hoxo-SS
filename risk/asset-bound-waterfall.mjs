import { previewDebtWaterfall } from "./cross-product-waterfall.mjs";

/**
 * Read-only provenance gate for M29's single-token debt waterfall.
 * The caller must supply independently verified contract identifiers and
 * source-ledger evidence; this module does not authenticate that evidence.
 * It cannot move tokens, settle debt, or approve leveraged trading.
 */
export function previewAssetBoundWaterfall({
  canonicalTokenContractId,
  debtTokenContractId,
  collateralProceedsTokenContractId,
  insuranceTokenContractId,
  liquidationCostTokenContractId,
  ...amounts
}) {
  const ids = {
    canonicalTokenContractId,
    debtTokenContractId,
    collateralProceedsTokenContractId,
    insuranceTokenContractId,
    liquidationCostTokenContractId,
  };
  for (const [name, value] of Object.entries(ids)) {
    if (typeof value !== "string" || !/^C[A-Z2-7]{55}$/.test(value)) {
      throw new TypeError(name + " must be an explicit Stellar contract identifier");
    }
  }
  for (const [name, value] of Object.entries(ids)) {
    if (value !== canonicalTokenContractId) {
      throw new Error(name + " does not match the canonical settlement token");
    }
  }
  const result = previewDebtWaterfall(amounts);
  return Object.freeze({
    ...result,
    canonicalTokenContractId,
    provenanceVerified: false,
    executable: false,
    riskApproved: false,
  });
}
