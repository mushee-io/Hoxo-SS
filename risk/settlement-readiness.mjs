/**
 * M34: fail-closed cross-product settlement readiness assessment.
 * This is a diagnostic ONLY. Caller-supplied evidence flags are never
 * sufficient to authorize Soroban transfers or liquidation.
 */
export const REQUIRED_SETTLEMENT_PROOFS = Object.freeze([
  "authenticatedLendingDebt",
  "authenticatedCollateralCustody",
  "authenticatedLiquidationProceeds",
  "freshOracleAndRiskState",
  "atomicSorobanSettlement",
  "rollbackAndConservationTests",
  "verifiedTestnetContractBindings",
  "signedTestnetTransactionReceipts",
  "independentSecurityReview",
]);
export function assessSettlementReadiness(evidence = {}) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("evidence must be a record");
  }
  // Flags are informational claims, not cryptographic verification. Even a
  // fully populated record must never become executable authorization.
  const claimed = Object.getOwnPropertyDescriptors(evidence);
  const unsupported = Reflect.ownKeys(claimed).filter(
    key => typeof key !== "string" || !REQUIRED_SETTLEMENT_PROOFS.includes(key)
  );
  if (unsupported.length) throw new TypeError("unexpected settlement evidence field");
  for (const descriptor of Object.values(claimed)) {
    if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "boolean") {
      throw new TypeError("settlement evidence flags must be boolean data properties");
    }
  }
  const missing = REQUIRED_SETTLEMENT_PROOFS.filter(key => claimed[key]?.value !== true);
  return Object.freeze({
    missing: Object.freeze(missing),
    claimedComplete: missing.length === 0,
    independentlyVerified: false,
    executable: false,
    tradingEnabled: false,
    reason: "Caller-supplied evidence cannot authorize financial Testnet execution",
  });
}
