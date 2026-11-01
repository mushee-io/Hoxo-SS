/** M39: read-only gap report. Never infers deployment or authorization from source files. */
import {validateRegistry} from "../infra/registry.mjs";

export const REQUIRED_EXECUTION_ROLES=Object.freeze([
  "collateral-vault","oracle-adapter","risk-engine","spot-settlement",
  "money-market","perp-clearinghouse","unified-margin",
  "custody-router","portfolio-accounting"
]);

export function assessNineContractCoverage(registry){
  const summary=validateRegistry(registry);
  const byRole=new Map(registry.contracts.map(x=>[x.role,x]));
  const roles=REQUIRED_EXECUTION_ROLES.map(role=>{
    const record=byRole.get(role);
    return {
      role,
      registered:!!record,
      candidateMetadata:record?.status==="candidate",
      independentlyVerified:false,
      blocker:!record?"missing-registry-role":record.status==="planned"?
        "not-deployed":"independent-onchain-proof-required"
    };
  });
  return {
    network:"testnet",
    expectedContracts:REQUIRED_EXECUTION_ROLES.length,
    registeredContracts:summary.contractCount,
    missingRoles:roles.filter(x=>!x.registered).map(x=>x.role),
    independentlyVerifiedContracts:0,
    executionEnabled:false,
    roles
  };
}
