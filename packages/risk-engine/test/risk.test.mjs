import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAccount, formatFixed, parseFixed, previewWithdrawal, previewPerpPositions } from "../src/index.mjs";

const NOW = 1_800_000_000;
const base = (overrides = {}) => ({
  nowSec: NOW, maxOracleAgeSec: 90, collateral: [], debts: [], perps: [], ...overrides,
});
const collateral = (amount, factor = 9000) => ({
  asset: "USDC", amount, priceUsd: "1", collateralFactorBps: factor, priceTimestampSec: NOW,
});
const debt = (amount) => ({
  asset: "USDC", amount, priceUsd: "1", priceTimestampSec: NOW,
});
const perp = (baseSize, mark = "10", entry = "10") => ({
  market: "XLM-PERP", baseSize, entryPriceUsd: entry, priceUsd: mark,
  initialMarginBps: 1000, maintenanceMarginBps: 500, priceTimestampSec: NOW,
});

test("decimal math is exact and rejects floating point / extra precision", () => {
  assert.equal(parseFixed("1.00000001"), 100000001n);
  assert.equal(formatFixed(-100000001n), "-1.00000001");
  assert.throws(() => parseFixed(1.2), /decimal string/);
  assert.throws(() => parseFixed("0.000000001"), /decimal string/);
  assert.throws(() => parseFixed("-1"), /Negative/);
});

test("no exposure yields a healthy empty account", () => {
  const result = evaluateAccount(base());
  assert.equal(result.status, "healthy");
  assert.equal(result.healthFactorBps, null);
  assert.equal(result.equityUsd, "0");
});

test("collateral is haircut and debts carry a reserve", () => {
  const result = evaluateAccount(base({
    collateral: [collateral("200")], debts: [debt("100")],
  }));
  assert.equal(result.adjustedCollateralUsd, "180");
  assert.equal(result.debtUsd, "100");
  assert.equal(result.equityUsd, "80");
  assert.equal(result.initialRequirementUsd, "20");
  assert.equal(result.maintenanceRequirementUsd, "10");
  assert.equal(result.availableMarginUsd, "60");
  assert.equal(result.status, "healthy");
});

test("linear perps: long loss and notional margin requirements", () => {
  const result = evaluateAccount(base({
    collateral: [collateral("100", 10000)],
    perps: [perp("2", "8", "10")],
  }));
  assert.equal(result.unrealizedPnlUsd, "-4");
  assert.equal(result.perpNotionalUsd, "16");
  assert.equal(result.initialRequirementUsd, "1.6");
  assert.equal(result.maintenanceRequirementUsd, "0.8");
  assert.equal(result.equityUsd, "96");
});

test("short has loss when price rises", () => {
  assert.equal(evaluateAccount(base({
    collateral: [collateral("100", 10000)],
    perps: [perp("-2", "12", "10")],
  })).unrealizedPnlUsd, "-4");
});

test("risk changes with position and cannot hide debts with perp profits", () => {
  const result = evaluateAccount(base({
    collateral: [collateral("50", 10000)],
    debts: [debt("40")], perps: [perp("10", "5", "10")],
  }));
  assert.equal(result.equityUsd, "-40");
  assert.equal(result.status, "liquidatable");
});

test("withdraw preview keeps the original state and checks post-withdrawal margin", () => {
  const account = base({ collateral: [collateral("200")], debts: [debt("100")] });
  assert.equal(previewWithdrawal(account, "USDC", "50").allowed, true);
  assert.equal(previewWithdrawal(account, "USDC", "100").allowed, false);
  assert.equal(previewWithdrawal(account, "USDC", "250").reason, "insufficient-balance");
  assert.equal(account.collateral[0].amount, "200");
});

test("pretrade preview evaluates the full posttrade positions", () => {
  const account = base({ collateral: [collateral("100", 10000)] });
  const a = previewPerpPositions(account, [perp("10", "10", "10")]);
  assert.equal(a.allowed, true);
  assert.equal(a.after.initialRequirementUsd, "10");
  const b = previewPerpPositions(account, [perp("150", "10", "10")]);
  assert.equal(b.allowed, false);
});

test("missing, future and stale oracle data fail closed", () => {
  const input = base({ collateral: [collateral("100")] });
  input.collateral[0].priceTimestampSec = NOW - 91;
  assert.throws(() => evaluateAccount(input), /stale oracle price/);
  input.collateral[0].priceTimestampSec = NOW + 1;
  assert.throws(() => evaluateAccount(input), /stale oracle price/);
  input.collateral[0].priceTimestampSec = NOW;
  input.collateral[0].priceUsd = "0";
  assert.throws(() => evaluateAccount(input), /positive/);
});

test("duplicate balances and positions are rejected", () => {
  assert.throws(() => evaluateAccount(base({
    collateral: [collateral("1"), collateral("1")],
  })), /duplicate/);
  assert.throws(() => evaluateAccount(base({
    perps: [perp("1"), perp("2")],
  })), /duplicate/);
});

test("reference policy rejects unsafe positions and malformed inputs", () => {
  assert.throws(() => evaluateAccount(base({
    collateral: [collateral("100", 10001)],
  })), /collateralFactorBps/);
  assert.throws(() => evaluateAccount(base({
    perps: [{ ...perp("1"), maintenanceMarginBps: 2000 }],
  })), /Initial margin/);
  assert.throws(() => evaluateAccount(base({
    debts: [debt("-1")],
  })), /Negative/);
});

test("losses round conservatively rather than toward zero", () => {
  const result = evaluateAccount(base({
    collateral: [collateral("1", 10000)],
    perps: [perp("0.00000001", "0.00000001", "0.00000002")],
  }));
  assert.equal(result.unrealizedPnlUsd, "-0.00000001");
});
