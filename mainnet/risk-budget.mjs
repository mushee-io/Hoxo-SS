/**
 * M24 offline, illustrative governance risk-budget model.
 * Uses bigint fixed-point arithmetic. No asset listing, oracle, margin
 * or limits are approved by this model: all input numbers are PROPOSALS.
 */
import {parseFixed,formatFixed,SCALE} from "../packages/risk-engine/src/index.mjs";
const FIELDS=[
  "totalCollateralUsd","outstandingDebtUsd","openInterestUsd",
  "insuranceReserveUsd","projectedStressLossUsd","singleAccountExposureUsd",
  "maxCollateralUsd","maxDebtUsd","maxOpenInterestUsd",
  "maxSingleAccountExposureUsd","collateralShockBps",
  "openInterestMarginBps","minimumInsuranceCoverageBps",
  "maximumOracleAgeSeconds","observedOracleAgeSeconds",
];
const MONEY=FIELDS.slice(0,10);
const BPS=10000n;
function inputPolicy(data){
  if(!data||typeof data!=="object"||Array.isArray(data)||
     JSON.stringify(Object.keys(data).sort())!==JSON.stringify([...FIELDS].sort()))
    throw Error("M24 proposed risk budget requires exact fields, no extra controls");
  const values={};
  for(const field of MONEY){
    const value=parseFixed(data[field]);
    if(value<0n||value>1_000_000_000_000n*SCALE)
      throw Error("M24 nonnegative bounded USD amount required: "+field);
    values[field]=value;
  }
  for(const key of ["collateralShockBps","openInterestMarginBps","minimumInsuranceCoverageBps"]){
    if(!Number.isSafeInteger(data[key])||data[key]<0||data[key]>10000)
      throw Error("M24 invalid basis points: "+key);
    values[key]=BigInt(data[key]);
  }
  for(const key of ["maximumOracleAgeSeconds","observedOracleAgeSeconds"]){
    if(!Number.isSafeInteger(data[key])||data[key]<0||data[key]>86400)
      throw Error("M24 oracle age must be a bounded integer: "+key);
    values[key]=data[key];
  }
  if(values.maximumOracleAgeSeconds===0)
    throw Error("M24 oracle freshness limit must be positive");
  return values;
}
const ceil=(n,d)=>(n+d-1n)/d;
export function evaluateM24ProposedRiskBudget(proposal){
  const v=inputPolicy(proposal);
  const haircut= v.totalCollateralUsd*(BPS-v.collateralShockBps)/BPS;
  const maintenance=ceil(v.openInterestUsd*v.openInterestMarginBps,BPS);
  const stressedEquity=haircut-v.outstandingDebtUsd-
    v.projectedStressLossUsd-maintenance;
  const requiredInsurance=ceil(v.projectedStressLossUsd*
    v.minimumInsuranceCoverageBps,BPS);
  const issues=[];
  if(v.totalCollateralUsd>v.maxCollateralUsd)issues.push("GLOBAL_COLLATERAL_CAP_EXCEEDED");
  if(v.outstandingDebtUsd>v.maxDebtUsd)issues.push("DEBT_CAP_EXCEEDED");
  if(v.openInterestUsd>v.maxOpenInterestUsd)issues.push("OPEN_INTEREST_CAP_EXCEEDED");
  if(v.singleAccountExposureUsd>v.maxSingleAccountExposureUsd)
    issues.push("ACCOUNT_EXPOSURE_CAP_EXCEEDED");
  if(v.singleAccountExposureUsd>v.openInterestUsd)
    issues.push("SINGLE_ACCOUNT_EXCEEDS_GLOBAL_OPEN_INTEREST");
  if(v.observedOracleAgeSeconds>v.maximumOracleAgeSeconds)
    issues.push("ORACLE_FRESHNESS_BREACH");
  if(v.insuranceReserveUsd<requiredInsurance)
    issues.push("INSURANCE_RESERVE_INADEQUATE");
  if(stressedEquity<0n)issues.push("STRESSED_EQUITY_NEGATIVE");
  if(v.collateralShockBps===0n)issues.push("ZERO_COLLATERAL_SHOCK_NOT_ACCEPTABLE");
  if(v.openInterestMarginBps===0n)issues.push("ZERO_PERP_MARGIN_NOT_ACCEPTABLE");
  return Object.freeze({
    milestone:"M24",
    evaluation:"OFFLINE_UNTRUSTED_GOVERNANCE_PROPOSAL_ONLY",
    state:issues.length?"LOCAL_RISK_BUDGET_BREACH":"LOCAL_PROPOSAL_WITHIN_DECLARED_BOUNDS_NOT_APPROVED",
    issues,
    stress: Object.freeze({
      discountedCollateralUsd:formatFixed(haircut),
      openInterestMarginReserveUsd:formatFixed(maintenance),
      requiredInsuranceUsd:formatFixed(requiredInsurance),
      stressedEquityUsd:formatFixed(stressedEquity),
      insuranceBufferUsd:formatFixed(v.insuranceReserveUsd-requiredInsurance),
    }),
    inputsIndependentOnchainProof:false,
    oracleSourceAuthenticated:false,
    riskCommitteeApproved:false,
    contractRiskEnforced:false,
    financialLaunchPermitted:false,
    mainnetTradePermitted:false,
  });
}
