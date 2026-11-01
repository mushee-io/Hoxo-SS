import test from "node:test";
import assert from "node:assert/strict";
import { previewAggregateLiquidations as preview } from "../risk/aggregate-liquidation.mjs";
const p=(id,debt,collateral,cost=0n)=>({id,accruedDebtE7:debt,realisedSeizedCollateralE7:collateral,liquidationCostE7:cost});
test("shared insurance is consumed once, never reused across debt positions",()=>{
 const r=preview([p("first",100n,0n),p("second",100n,0n)],50n);
 assert.equal(r.positions[0].insuranceUsedE7,50n);
 assert.equal(r.positions[1].insuranceUsedE7,0n);
 assert.equal(r.totals.lenderShortfallE7,150n);
 assert.equal(r.insuranceRemainingE7,0n);
 assert.equal(r.executable,false);
});
test("fees, collateral, debt and shared insurance conserve across positions",()=>{
 for(let d=0n;d<12n;d++)for(let c=0n;c<12n;c++)for(let i=0n;i<12n;i++){
  const r=preview([p("a",d,c,2n),p("b",d+1n,c+1n,1n)],i);
  const t=r.totals;
  assert.equal(t.debtPaidFromCollateralE7+t.insuranceUsedE7+t.lenderShortfallE7,t.debtE7);
  assert.equal(t.liquidationCostsPaidE7+t.debtPaidFromCollateralE7+t.borrowerSurplusE7,t.realisedCollateralE7);
  assert.equal(t.insuranceUsedE7+r.insuranceRemainingE7,i);
 }
});
test("rejects duplicate ids, malformed records, accessors, and out-of-range amounts",()=>{
 assert.throws(()=>preview([p("a",1n,0n),p("a",1n,0n)],1n),/unique/);
 assert.throws(()=>preview([p("a",1n,0n)],1n<<127n),/i128/);
 assert.throws(()=>preview([p("a",1n<<127n,0n)],1n),/i128/);
 assert.throws(()=>preview(Array(65).fill(p("a",1n,0n)),1n),/64/);
 let invoked=false;
 const malicious=p("a",1n,0n);
 Object.defineProperty(malicious,"accruedDebtE7",{get(){invoked=true;throw Error("getter ran")}});
 assert.throws(()=>preview([malicious],1n),/data properties/);
 assert.equal(invoked,false);
 assert.throws(()=>preview([{...p("a",1n,0n), riskApproved:true}],1n),/four required/);
});
test("empty and maximum i128 positions remain non-executable",()=>{
 const max=(1n<<127n)-1n;
 assert.equal(preview([],max).insuranceRemainingE7,max);
 const r=preview([p("large",max,max,max)],max);
 assert.equal(r.totals.debtE7,max);
 assert.equal(r.totals.insuranceUsedE7,max);
 assert.equal(r.tradingEnabled,false);
});
