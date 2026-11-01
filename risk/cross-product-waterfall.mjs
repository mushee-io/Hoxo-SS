/**
 * M29: conservative, read-only debt-loss waterfall for Testnet review.
 * NOT a Soroban settlement engine or trading permission. Values are exact
 * non-negative integer units of the SAME canonical token (e7).
 * Never accepts unrealised PnL, nominal loan receivables, or other assets.
 */
function units(value, name) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError(name + " must be a non-negative bigint in e7 units");
  }
  return value;
}
const min = (a,b) => a < b ? a : b;
export function previewDebtWaterfall({
  accruedDebtE7, realisedSeizedCollateralE7, insuranceAvailableE7,
  liquidationCostE7 = 0n,
}) {
  const debt = units(accruedDebtE7,"accruedDebtE7");
  const collateral = units(realisedSeizedCollateralE7,"realisedSeizedCollateralE7");
  const insurance = units(insuranceAvailableE7,"insuranceAvailableE7");
  const cost = units(liquidationCostE7,"liquidationCostE7");
  // Costs are paid only from actual realised collateral. Any unfunded cost
  // cannot be charged to lender claims or silently taken from insurance.
  const paidCost = min(collateral,cost);
  const proceeds = collateral-paidCost;
  const recoveredFromCollateral = min(debt,proceeds);
  const remainingDebt = debt-recoveredFromCollateral;
  const insuranceUsed = min(insurance,remainingDebt);
  const lenderShortfall = remainingDebt-insuranceUsed;
  const borrowerSurplus = proceeds-recoveredFromCollateral;
  const result = {
    accruedDebtE7:debt, realisedSeizedCollateralE7:collateral,
    liquidationCostPaidE7:paidCost,
    liquidationCostUnfundedE7:cost-paidCost,
    debtPaidFromCollateralE7:recoveredFromCollateral,
    insuranceUsedE7:insuranceUsed,
    lenderShortfallE7:lenderShortfall,
    borrowerSurplusE7:borrowerSurplus,
    insuranceRemainingE7:insurance-insuranceUsed,
    debtFullyCovered:lenderShortfall===0n,
    executable:false,
    riskApproved:false,
  };
  // Both sides of each conservation equation must hold without any
  // double-spend of collateral or insurance.
  if (paidCost+recoveredFromCollateral+borrowerSurplus!==collateral ||
      recoveredFromCollateral+insuranceUsed+lenderShortfall!==debt ||
      insuranceUsed+result.insuranceRemainingE7!==insurance) {
    throw new Error("Debt waterfall conservation failure");
  }
  return Object.freeze(result);
}
