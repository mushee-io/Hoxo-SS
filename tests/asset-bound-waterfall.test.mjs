import test from "node:test";
import assert from "node:assert/strict";
import { previewAssetBoundWaterfall } from "../risk/asset-bound-waterfall.mjs";
const TOKEN = "C" + "A".repeat(55);
const OTHER = "C" + "B".repeat(55);
const valid = () => ({
  canonicalTokenContractId: TOKEN,
  debtTokenContractId: TOKEN,
  collateralProceedsTokenContractId: TOKEN,
  insuranceTokenContractId: TOKEN,
  liquidationCostTokenContractId: TOKEN,
  accruedDebtE7: 100n,
  realisedSeizedCollateralE7: 60n,
  insuranceAvailableE7: 30n,
  liquidationCostE7: 10n,
});
test("same-token accounting remains conservative and non-executable", () => {
  const r = previewAssetBoundWaterfall(valid());
  assert.equal(r.debtPaidFromCollateralE7, 50n);
  assert.equal(r.insuranceUsedE7, 30n);
  assert.equal(r.lenderShortfallE7, 20n);
  assert.equal(r.provenanceVerified, false);
  assert.equal(r.executable, false);
  assert.equal(r.riskApproved, false);
  assert.ok(Object.isFrozen(r));
});
test("rejects cross-token substitution at every source", () => {
  for (const key of ["debtTokenContractId", "collateralProceedsTokenContractId", "insuranceTokenContractId", "liquidationCostTokenContractId"]) {
    assert.throws(() => previewAssetBoundWaterfall({...valid(), [key]: OTHER}), /does not match/);
  }
});
test("rejects absent and malformed token identifiers", () => {
  for (const key of ["canonicalTokenContractId", "debtTokenContractId", "collateralProceedsTokenContractId", "insuranceTokenContractId", "liquidationCostTokenContractId"]) {
    for (const value of [undefined, null, "", "native", "G" + "A".repeat(55), "C" + "0".repeat(55)]) {
      assert.throws(() => previewAssetBoundWaterfall({...valid(), [key]: value}), /contract identifier/);
    }
  }
});
test("rejects non-i128 amounts after asset compatibility check", () => {
  assert.throws(() => previewAssetBoundWaterfall({...valid(), accruedDebtE7: 1n << 127n}), /i128 range/);
});
