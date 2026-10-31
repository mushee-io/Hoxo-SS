import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {m24Readiness,assertM24LaunchAuthorized,M24_CRITERIA} from "../mainnet/readiness.mjs";
import {evaluateM24ProposedRiskBudget} from "../mainnet/risk-budget.mjs";
import {prepareM24EvidencePacket,M24_PACKET_FILES} from "../mainnet/evidence.mjs";
import {simulateM24Incident,M24_INCIDENT_TYPES} from "../mainnet/incident.mjs";
import {parseFixed} from "../packages/risk-engine/src/index.mjs";

const SHA="e".repeat(40);
async function registry(){
  return JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
}
async function temp(t){
  const directory=await mkdtemp(join(tmpdir(),"hoxo-m24-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}
function proposal(overrides={}){
  return {
    totalCollateralUsd:"1000",
    outstandingDebtUsd:"100",
    openInterestUsd:"200",
    insuranceReserveUsd:"100",
    projectedStressLossUsd:"10",
    singleAccountExposureUsd:"25",
    maxCollateralUsd:"1000000",
    maxDebtUsd:"1000000",
    maxOpenInterestUsd:"1000000",
    maxSingleAccountExposureUsd:"1000000",
    collateralShockBps:1000,
    openInterestMarginBps:1000,
    minimumInsuranceCoverageBps:10000,
    maximumOracleAgeSeconds:60,
    observedOracleAgeSeconds:20,
    ...overrides,
  };
}
function rng(seed=0x2346D41D){
  let s=seed>>>0;
  return max=>{
    s^=s<<13;s^=s>>>17;s^=s<<5;
    return (s>>>0)%max;
  };
}
test("M24 current mainnet readiness requires 12 real independent release criteria",async()=>{
  const r=await registry();
  const state=m24Readiness(r);
  assert.equal(state.state,"NO_GO_INDEPENDENT_APPROVAL_AND_LIVE_PROOF_MISSING");
  assert.equal(state.mainnetLaunchApproved,false);
  assert.equal(state.mainnetOperationsEnabled,false);
  assert.equal(state.mainnetTransactionsSubmitted,0);
  assert.equal(state.financialTestnetBetaOpen,false);
  assert.equal(state.unresolvedCriteria,12);
  assert.equal(state.blockers.length,M24_CRITERIA.length);
  assert.equal(state.productionTVLUsd,null);
  assert.ok(state.blockers.every(x=>x.status==="OPEN"&&!x.verifiedByIndependentAuthority));
  assert.equal(state.dependencies.M23,"BLOCKED_UNVERIFIED_PUBLIC_BETA");
});
test("M24 rejects forged independent audit, governance, liquidity and legal approvals",async()=>{
  const r=await registry();
  const forged={...r,network:"testnet",externalAuditorApproved:true,
    governanceApproved:true,liquidityUsd:"1000000000",legalApproved:true,
    allChecksPassed:true,mainnetLaunchApproved:true,
    launchPermit:{signatures:["fake"],status:"APPROVED"}};
  assert.equal(m24Readiness(forged).mainnetLaunchApproved,false);
  assert.throws(()=>assertM24LaunchAuthorized(forged),error=>
    error.code==="M24_LAUNCH_PROHIBITED"&&
    error.assessment.unresolvedCriteria===12&&
    error.assessment.mainnetOperationsEnabled===false);
});
test("M24 honest CLI reports no-go and its require-go command exits nonzero",()=>{
  const cli=spawnSync(process.execPath,["scripts/check-m24.mjs"],{encoding:"utf8"});
  assert.equal(cli.status,0,cli.stderr);
  const result=JSON.parse(cli.stdout);
  assert.equal(result.state,"NO_GO_INDEPENDENT_APPROVAL_AND_LIVE_PROOF_MISSING");
  const denied=spawnSync(process.execPath,["scripts/check-m24.mjs","--require-go"],
    {encoding:"utf8"});
  assert.notEqual(denied.status,0);
  assert.match(denied.stderr,/M24 MAINNET NO-GO/);
});
test("M24 proposed risk model computes integer stress and never grants financial authority",()=>{
  const result=evaluateM24ProposedRiskBudget(proposal());
  assert.equal(result.state,"LOCAL_PROPOSAL_WITHIN_DECLARED_BOUNDS_NOT_APPROVED");
  assert.deepEqual(result.issues,[]);
  assert.equal(result.stress.discountedCollateralUsd,"900");
  assert.equal(result.stress.openInterestMarginReserveUsd,"20");
  assert.equal(result.stress.requiredInsuranceUsd,"10");
  assert.equal(result.stress.stressedEquityUsd,"770");
  assert.equal(result.inputsIndependentOnchainProof,false);
  assert.equal(result.riskCommitteeApproved,false);
  assert.equal(result.financialLaunchPermitted,false);
});
test("M24 risk model fails on cap breach, loss, collateral stress, stale oracle, insurance or malformed quantities",()=>{
  for(const [delta,reason] of [
    [{maxCollateralUsd:"999"},"GLOBAL_COLLATERAL_CAP_EXCEEDED"],
    [{maxDebtUsd:"99"},"DEBT_CAP_EXCEEDED"],
    [{maxOpenInterestUsd:"199"},"OPEN_INTEREST_CAP_EXCEEDED"],
    [{maxSingleAccountExposureUsd:"24"},"ACCOUNT_EXPOSURE_CAP_EXCEEDED"],
    [{singleAccountExposureUsd:"210"},"SINGLE_ACCOUNT_EXCEEDS_GLOBAL_OPEN_INTEREST"],
    [{observedOracleAgeSeconds:61},"ORACLE_FRESHNESS_BREACH"],
    [{insuranceReserveUsd:"9"},"INSURANCE_RESERVE_INADEQUATE"],
    [{projectedStressLossUsd:"950",insuranceReserveUsd:"950"},"STRESSED_EQUITY_NEGATIVE"],
    [{collateralShockBps:0},"ZERO_COLLATERAL_SHOCK_NOT_ACCEPTABLE"],
    [{openInterestMarginBps:0},"ZERO_PERP_MARGIN_NOT_ACCEPTABLE"],
  ]){
    const result=evaluateM24ProposedRiskBudget(proposal(delta));
    assert.ok(result.issues.includes(reason),reason);
    assert.equal(result.mainnetTradePermitted,false);
  }
  for(const bad of [
    {totalCollateralUsd:"-1"},
    {outstandingDebtUsd:"1e9"},
    {maxDebtUsd:1000},
    {collateralShockBps:-1},
    {minimumInsuranceCoverageBps:10001},
    {maximumOracleAgeSeconds:0},
    {observedOracleAgeSeconds:86401},
    {unauthorizedApproval:true},
  ])assert.throws(()=>evaluateM24ProposedRiskBudget(proposal(bad)));
});
test("M24 2000 seeded economic stress proposals cannot improve under more debt or worse price shock",()=>{
  const random=rng();
  for(let i=0;i<2000;i++){
    const collateral=random(50000)+1000;
    const debt=random(12000)+1;
    const notional=random(15000)+1;
    const loss=random(400)+1;
    const shock=random(5000)+1;
    const p=proposal({totalCollateralUsd:String(collateral),
      outstandingDebtUsd:String(debt),openInterestUsd:String(notional),
      projectedStressLossUsd:String(loss),insuranceReserveUsd:String(10000),
      singleAccountExposureUsd:String(Math.min(25,notional)),
      collateralShockBps:shock});
    const baseline=evaluateM24ProposedRiskBudget(p);
    const worseDebt=evaluateM24ProposedRiskBudget({...p,outstandingDebtUsd:String(debt+1)});
    const worseShock=evaluateM24ProposedRiskBudget({...p,collateralShockBps:shock+1});
    const eq=x=>parseFixed(x.stress.stressedEquityUsd,{signed:true});
    assert.ok(eq(worseDebt)<=eq(baseline),"Debt monotonic stress "+i);
    assert.ok(eq(worseShock)<=eq(baseline),"Price monotonic stress "+i);
    assert.equal(baseline.financialLaunchPermitted,false);
    assert.equal(worseDebt.financialLaunchPermitted,false);
  }
});
test("M24 real-byte evidence inventory is deterministic but never verifies signatures/approvals",async t=>{
  const directory=await temp(t),r=await registry();
  const empty=await prepareM24EvidencePacket({directory,registry:r,sourceRevision:SHA});
  assert.equal(empty.status,"ARTIFACT_INVENTORY_ONLY");
  assert.equal(empty.missing.length,M24_PACKET_FILES.length);
  assert.equal(empty.launchPermitted,false);
  assert.equal(empty.independentAuditorSignatureVerified,false);
  await writeFile(join(directory,"audit-report.pdf"),Buffer.from("%PDF-1.7\npseudo-audit-does-NOT-sign"));
  await writeFile(join(directory,"testnet-deployments.json"),JSON.stringify({claim:"fake"}));
  const one=await prepareM24EvidencePacket({directory,registry:r,sourceRevision:SHA});
  const two=await prepareM24EvidencePacket({directory,registry:r,sourceRevision:SHA});
  assert.equal(one.deterministicInventorySha256,two.deterministicInventorySha256);
  assert.equal(one.files.filter(x=>x.sha256).length,2);
  assert.equal(one.missing.length,M24_PACKET_FILES.length-2);
  assert.equal(one.governanceSignaturesVerified,false);
  assert.equal(one.launchPermitted,false);
  await writeFile(join(directory,"audit-report.pdf"),Buffer.from("%PDF-1.7\naltered-audit-contents"));
  const mutated=await prepareM24EvidencePacket({directory,registry:r,sourceRevision:SHA});
  assert.notEqual(mutated.deterministicInventorySha256,one.deterministicInventorySha256);
});
test("M24 evidence inventory fails on forged revision, symlinks, invalid PDF/JSON and empty files",async t=>{
  const directory=await temp(t),r=await registry();
  await assert.rejects(()=>prepareM24EvidencePacket({
    directory,registry:r,sourceRevision:"main"}),/40-digit/);
  await writeFile(join(directory,"audit-report.pdf"),"not-pdf");
  await assert.rejects(()=>prepareM24EvidencePacket({
    directory,registry:r,sourceRevision:SHA}),/PDF header/);
  await writeFile(join(directory,"audit-report.pdf"),Buffer.from("%PDF-1.6\n"));
  await writeFile(join(directory,"testnet-deployments.json"),"not-json");
  await assert.rejects(()=>prepareM24EvidencePacket({
    directory,registry:r,sourceRevision:SHA}),/JSON invalid/);
  await writeFile(join(directory,"testnet-deployments.json"),"{}");
  const secret=join(directory,"foreign-evidence.txt");
  await writeFile(secret,"private evidence");
  await symlink(secret,join(directory,"audit-remediation.pdf"));
  await assert.rejects(()=>prepareM24EvidencePacket({
    directory,registry:r,sourceRevision:SHA}),/no symlink/);
});
test("M24 exercises every defined tabletop incident without signing or moving funds",()=>{
  assert.equal(M24_INCIDENT_TYPES.length,6);
  for(const type of M24_INCIDENT_TYPES){
    const drill=simulateM24Incident(type);
    assert.equal(drill.scenario,type);
    assert.equal(drill.remoteControlInvoked,false);
    assert.equal(drill.onchainPauseExecuted,false);
    assert.equal(drill.walletsSigned,false);
    assert.equal(drill.fundsMoved,false);
    assert.equal(drill.liveIncidentResolved,false);
    assert.equal(drill.launchPermitted,false);
    assert.ok(drill.actionPlan.length>=3);
    assert.ok(drill.actionPlan.every(x=>x.executed===false));
    assert.ok(drill.requiredEvidence.every(x=>x.verified===false));
  }
  assert.throws(()=>simulateM24Incident("MAINNET_LAUNCH"),/unknown/);
  assert.throws(()=>simulateM24Incident("oracle_stale",{operatorRole:"x"}),/invalid/);
});
test("M24 incident CLI provides a tabletop drill only, never a real guardian action",()=>{
  const result=spawnSync(process.execPath,["scripts/m24-drill.mjs","rpc_fork"],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const drill=JSON.parse(result.stdout);
  assert.equal(drill.scenario,"rpc_fork");
  assert.equal(drill.remoteControlInvoked,false);
  assert.equal(drill.fundsMoved,false);
});
