import test from "node:test";
import assert from "node:assert/strict";
import { assessSettlementReadiness, REQUIRED_SETTLEMENT_PROOFS } from "../risk/settlement-readiness.mjs";

test("empty evidence identifies every cross-product execution blocker", () => {
  const result = assessSettlementReadiness();
  assert.deepEqual(result.missing, REQUIRED_SETTLEMENT_PROOFS);
  assert.equal(result.executable, false);
  assert.equal(result.tradingEnabled, false);
});
test("claimed proofs never authorize liquidation or trading", () => {
  const claimed = Object.fromEntries(REQUIRED_SETTLEMENT_PROOFS.map(k => [k, true]));
  const result = assessSettlementReadiness(claimed);
  assert.equal(result.claimedComplete, true);
  assert.equal(result.independentlyVerified, false);
  assert.equal(result.executable, false);
  assert.equal(result.tradingEnabled, false);
});
test("rejects injected authorizations, malformed values and accessors", () => {
  assert.throws(() => assessSettlementReadiness({ riskApproved: true }), /unexpected/);
  assert.throws(() => assessSettlementReadiness({ authenticatedLendingDebt: "true" }), /boolean/);
  const input = {};
  let called = false;
  Object.defineProperty(input, "authenticatedLendingDebt", { get() { called = true; throw Error("executed"); } });
  assert.throws(() => assessSettlementReadiness(input), /boolean data/);
  assert.equal(called, false);
});
