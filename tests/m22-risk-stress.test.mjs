/**
 * M22 deterministic property fuzzing of the OFFLINE reference risk engine.
 * This never certifies real on-chain collateral, oracle or liquidations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {evaluateAccount,previewWithdrawal,parseFixed} from "../packages/risk-engine/src/index.mjs";
import {reviewOracle} from "../marketdata/oracle-guard.mjs";
import {m22AuditReadiness,assertM22ReleaseApproved,M22_OPEN_BLOCKERS} from "../security/m22-review.mjs";
import {readFile} from "node:fs/promises";
const NOW=1_800_000_000;
const MS=NOW*1000;
function random(seed=0x22A017B2){
  let state=seed>>>0;
  return function(max) {
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)%max;
  };
}
function account(c,d,perpSize=0,mark=100,entry=100){
  return {nowSec:NOW,maxOracleAgeSec:120,
    collateral:[{asset:"TEST",amount:String(c),priceUsd:"1",
      collateralFactorBps:8500,priceTimestampSec:NOW}],
    debts:[{asset:"TEST",amount:String(d),priceUsd:"1",priceTimestampSec:NOW}],
    perps:perpSize===0?[]:[{market:"TEST-PERP",baseSize:String(perpSize),
      priceUsd:String(mark),entryPriceUsd:String(entry),
      initialMarginBps:2500,maintenanceMarginBps:1500,priceTimestampSec:NOW}],
  };
}
test("M22 2,000 seeded economic cases: collateral increase, debt increase, withdrawal safety",()=>{
  const rnd=random();
  for(let i=0;i<2000;i++){
    const c=rnd(100000)+1,d=rnd(100000)+1;
    const a=account(c,d);
    const baseline=evaluateAccount(a);
    const extra=evaluateAccount(account(c+1,d));
    const debt=evaluateAccount(account(c,d+1));
    assert.ok(parseFixed(extra.equityUsd,{signed:true})>=parseFixed(baseline.equityUsd,{signed:true}),"collateral seed "+i);
    assert.ok(parseFixed(debt.equityUsd,{signed:true})<=parseFixed(baseline.equityUsd,{signed:true}),"debt seed "+i);
    assert.ok(parseFixed(debt.initialRequirementUsd)>=parseFixed(baseline.initialRequirementUsd));
    assert.ok(parseFixed(extra.availableMarginUsd,{signed:true})>=parseFixed(baseline.availableMarginUsd,{signed:true}));
    assert.ok(parseFixed(debt.availableMarginUsd,{signed:true})<=parseFixed(baseline.availableMarginUsd,{signed:true}));
    const withdrawal=previewWithdrawal(a,"TEST","1");
    assert.ok(parseFixed(withdrawal.postWithdrawal.equityUsd,{signed:true})<=parseFixed(baseline.equityUsd,{signed:true}));
    if(withdrawal.allowed)assert.equal(withdrawal.postWithdrawal.status,"healthy");
    assert.equal(a.collateral[0].amount,String(c),"preview must not mutate source");
  }
});
test("M22 1,000 seeded adverse long/short price shocks worsen rather than improve equity",()=>{
  const rnd=random(0x1234F00D);
  for(let i=0;i<1000;i++){
    const c=rnd(10000)+1,q=rnd(50)+1,m=rnd(300)+2;
    const long=evaluateAccount(account(c,1,q,m,m));
    const longShock=evaluateAccount(account(c,1,q,m-1,m));
    assert.ok(parseFixed(longShock.equityUsd,{signed:true})<parseFixed(long.equityUsd,{signed:true}));
    const short=evaluateAccount(account(c,1,-q,m,m));
    const shortShock=evaluateAccount(account(c,1,-q,m+1,m));
    assert.ok(parseFixed(shortShock.equityUsd,{signed:true})<parseFixed(short.equityUsd,{signed:true}));
  }
});
test("M22 1,000 mutated oracle envelopes never become executable, stale/spoofed samples halt",()=>{
  const rnd=random(0xDEC0DE22);
  for(let i=0;i<1000;i++){
    const n=rnd(10000)+1;
    const price=String(n);
    const samples=[
      {marketId:"TEST",sourceId:"A",timestampMs:MS,price},
      {marketId:"TEST",sourceId:"B",timestampMs:MS,price},
    ];
    const good=reviewOracle(samples,{marketId:"TEST",nowMs:MS,halt:false,markMid:price});
    assert.equal(good.state,"candidate-only");assert.equal(good.riskExecutable,false);
    assert.equal(reviewOracle(samples,{marketId:"TEST",nowMs:MS}).state,"halted");
    const stale=samples.map(s=>({...s,timestampMs:MS-120001}));
    assert.equal(reviewOracle(stale,{marketId:"TEST",nowMs:MS,halt:false}).state,"halted");
    const duplicate=samples.map(s=>({...s,sourceId:"A"}));
    assert.equal(reviewOracle(duplicate,{marketId:"TEST",nowMs:MS,halt:false}).state,"halted");
    const wrong=samples.map(s=>({...s,marketId:"OTHER"}));
    assert.equal(reviewOracle(wrong,{marketId:"TEST",nowMs:MS,halt:false}).state,"halted");
  }
});
test("M22 audit gate is immutable to self-attested release claims",async()=>{
  const registry=JSON.parse(await readFile(
    new URL("../registry/testnet.json",import.meta.url),"utf8"));
  const base=m22AuditReadiness(registry);
  assert.equal(base.mainnetPermitted,false);
  assert.equal(base.publicBetaPermitted,false);
  assert.equal(base.externalAuditorApproved,false);
  assert.equal(base.unresolvedCount,M22_OPEN_BLOCKERS.length);
  assert.ok(M22_OPEN_BLOCKERS.some(x=>x.severity==="critical"));
  assert.throws(()=>assertM22ReleaseApproved(registry),e=>
    e.code==="M22_RELEASE_BLOCKED"&&e.status.unresolvedCount>=1);
  const deceptive={...registry,independentlyAudited:true,
    approvals:[{claim:"independent review complete"}]};
  assert.equal(m22AuditReadiness(deceptive).mainnetPermitted,false);
  assert.throws(()=>assertM22ReleaseApproved(deceptive),/DENIED/);
});
