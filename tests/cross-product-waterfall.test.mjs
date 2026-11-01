import test from "node:test";
import assert from "node:assert/strict";
import {previewDebtWaterfall as preview} from "../risk/cross-product-waterfall.mjs";
const run=(debt,collateral,insurance,cost=0n)=>preview({
  accruedDebtE7:debt,realisedSeizedCollateralE7:collateral,
  insuranceAvailableE7:insurance,liquidationCostE7:cost,
});
test("full repayment returns only realised collateral surplus",()=>{
  const r=run(100n,160n,20n,10n);
  assert.equal(r.debtPaidFromCollateralE7,100n);
  assert.equal(r.borrowerSurplusE7,50n);
  assert.equal(r.insuranceUsedE7,0n);
  assert.equal(r.lenderShortfallE7,0n);
  assert.equal(r.executable,false);
  assert.equal(r.riskApproved,false);
});
test("shortfall consumes bounded insurance without minting loan repayments",()=>{
  const r=run(100n,40n,25n,5n);
  assert.equal(r.debtPaidFromCollateralE7,35n);
  assert.equal(r.insuranceUsedE7,25n);
  assert.equal(r.lenderShortfallE7,40n);
  assert.equal(r.insuranceRemainingE7,0n);
  assert.equal(r.debtFullyCovered,false);
});
test("zero collateral and exhausted insurance leave full lender loss",()=>{
  const r=run(100n,0n,0n,20n);
  assert.equal(r.lenderShortfallE7,100n);
  assert.equal(r.liquidationCostUnfundedE7,20n);
});
test("liquidation costs cannot spend unreceived tokens",()=>{
  const r=run(100n,10n,100n,50n);
  assert.equal(r.liquidationCostPaidE7,10n);
  assert.equal(r.liquidationCostUnfundedE7,40n);
  assert.equal(r.insuranceUsedE7,100n);
  assert.equal(r.borrowerSurplusE7,0n);
});
test("rejects floating point, negative, missing and string balances",()=>{
  for(const value of [-1n,1,1.5,"100",null,undefined]){
    assert.throws(()=>preview({
      accruedDebtE7:value,realisedSeizedCollateralE7:0n,
      insuranceAvailableE7:0n,
    }),/non-negative bigint/);
  }
});
test("bounded exhaustive conservation across debt, collateral, insurance and costs",()=>{
  for(let d=0n;d<=20n;d++)for(let c=0n;c<=20n;c++)
    for(let i=0n;i<=10n;i++)for(let fee=0n;fee<=3n;fee++){
      const r=run(d,c,i,fee);
      assert.equal(r.liquidationCostPaidE7+r.debtPaidFromCollateralE7+r.borrowerSurplusE7,c);
      assert.equal(r.debtPaidFromCollateralE7+r.insuranceUsedE7+r.lenderShortfallE7,d);
      assert.equal(r.insuranceUsedE7+r.insuranceRemainingE7,i);
      assert.equal(r.executable,false);
    }
});

test("rejects values outside signed Soroban i128 for every monetary input",()=>{
  const tooLarge=1n<<127n;
  for (const field of ["accruedDebtE7","realisedSeizedCollateralE7","insuranceAvailableE7","liquidationCostE7"]) {
    const args={accruedDebtE7:0n,realisedSeizedCollateralE7:0n,insuranceAvailableE7:0n,liquidationCostE7:0n};
    args[field]=tooLarge;
    assert.throws(()=>preview(args),/i128 range/);
  }
});
test("i128 maximum values conserve collateral and insurance exactly",()=>{
  const max=(1n<<127n)-1n;
  const r=run(max,max,max,max);
  assert.equal(r.liquidationCostPaidE7,max);
  assert.equal(r.insuranceUsedE7,max);
  assert.equal(r.lenderShortfallE7,0n);
  assert.equal(r.borrowerSurplusE7,0n);
  assert.equal(r.insuranceRemainingE7,0n);
  assert.equal(r.executable,false);
});
