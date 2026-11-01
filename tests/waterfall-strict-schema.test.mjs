import test from "node:test";
import assert from "node:assert/strict";
import { previewAssetBoundWaterfall } from "../risk/asset-bound-waterfall.mjs";

const TOKEN = "C" + "A".repeat(55);
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
test("valid preview remains non-executable with exact conservation", () => {
  const result = previewAssetBoundWaterfall(valid());
  assert.equal(result.debtPaidFromCollateralE7 + result.insuranceUsedE7 + result.lenderShortfallE7, 100n);
  assert.equal(result.provenanceVerified, false);
  assert.equal(result.executable, false);
  assert.equal(result.riskApproved, false);
});
test("unexpected fields fail closed rather than being silently discarded", () => {
  for (const extra of ["accruedDebt", "oraclePriceE7", "riskApproved", "sourceLedger", "__proto__"]) {
    const input = valid();
    Object.defineProperty(input, extra, { value: 1n, enumerable: true, configurable: true });
    assert.throws(() => previewAssetBoundWaterfall(input), /unexpected waterfall input field/);
  }
});
test("symbol keys and non-record inputs fail closed", () => {
  const input = valid();
  input[Symbol("hidden")] = true;
  assert.throws(() => previewAssetBoundWaterfall(input), /unexpected waterfall input field/);
  for (const bad of [null, undefined, [], 5, "record", new Date()]) {
    assert.throws(() => previewAssetBoundWaterfall(bad), /plain record/);
  }
});
test("mandatory fields cannot be absent or inherited", () => {
  for (const key of ["canonicalTokenContractId", "accruedDebtE7", "realisedSeizedCollateralE7", "insuranceAvailableE7"]) {
    const input = valid();
    delete input[key];
    assert.throws(() => previewAssetBoundWaterfall(input), /missing waterfall input field/);
  }
});
test("zero-cost default remains supported", () => {
  const input = valid();
  delete input.liquidationCostE7;
  assert.equal(previewAssetBoundWaterfall(input).liquidationCostPaidE7, 0n);
});

test("accessor-backed amounts and tokens are rejected without invoking getters", () => {
  for (const key of ["accruedDebtE7", "canonicalTokenContractId", "liquidationCostE7"]) {
    const input = valid();
    let called = 0;
    Object.defineProperty(input, key, { enumerable: true, configurable: true, get() { called++; throw new Error("getter executed"); } });
    assert.throws(() => previewAssetBoundWaterfall(input), /accessor waterfall input field/);
    assert.equal(called, 0);
  }
});
test("non-enumerable own monetary data is still validated", () => {
  const input = valid();
  Object.defineProperty(input, "accruedDebtE7", { value: -1n, enumerable: false, configurable: true });
  assert.throws(() => previewAssetBoundWaterfall(input));
});
