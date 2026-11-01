import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assessNineContractCoverage,REQUIRED_EXECUTION_ROLES} from "../deployment/nine-contract-coverage.mjs";
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
test("M39 reports missing execution bindings without inventing addresses",()=>{
  const report=assessNineContractCoverage(registry);
  assert.equal(REQUIRED_EXECUTION_ROLES.length,9);
  assert.equal(report.registeredContracts,7);
  assert.deepEqual(report.missingRoles,["custody-router","portfolio-accounting"]);
  assert.equal(report.independentlyVerifiedContracts,0);
  assert.equal(report.executionEnabled,false);
  assert.ok(report.roles.every(x=>x.independentlyVerified===false));
});
test("M39 candidate metadata cannot authorize execution",()=>{
  const clone=structuredClone(registry);
  clone.contracts[0].status="candidate";
  // Syntactically valid StrKey is not needed: fail-closed registry rejects fabricated IDs.
  clone.contracts[0].contractId="C"+"A".repeat(55);
  clone.contracts[0].deploymentTxHash="a".repeat(64);
  clone.contracts[0].verifiedAtLedger=123;
  assert.throws(()=>assessNineContractCoverage(clone),/Candidate contracts/);
});
test("M39 wrong network and unexpected roles fail closed",()=>{
  assert.throws(()=>assessNineContractCoverage({...registry,network:"mainnet"}),/Testnet/);
  assert.throws(()=>assessNineContractCoverage({...registry,contracts:[...registry.contracts,registry.contracts[0]]}),/roles/);
});
