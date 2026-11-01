import test from "node:test";
import assert from "node:assert/strict";
import {inspectM9Candidate} from "../verification/m9-candidate-evidence.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
const candidate={
  networkPassphrase:TESTNET_PASSPHRASE,role:"spot-settlement",
  contractId:"CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF",
  owner:"GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB",
  constructorOwner:"GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB",
  wasmUploadTxHash:"2ba5e907a26265f8f818de342367b266a07d7082ea90b4815112fc5d715758bd",
  deploymentTxHash:"91280d18358b642ae31668ed114b879a52e175c842ee869f23d28666558e640a",
  wasmUploadLedger:5506305,deploymentLedger:5506371,
  reportedWasmFileSha256:"916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3",
  adminVerified:"unknown",pausedVerified:"unknown",
  onchainCodeHashVerified:"unknown",deploymentXdrLinked:"unknown"
};
test("M9 reported candidate is explicitly non-executable",()=>{
  const report=inspectM9Candidate(candidate);
  assert.equal(report.registryPromotionAllowed,false);
  assert.equal(report.spotTradingAllowed,false);
  assert.equal(report.publicBetaAllowed,false);
  assert.equal(report.outstanding.length,6);
});
test("candidate rejects mainnet, forged fields, inconsistent ledgers and hash",()=>{
  const changes=[
    {networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {role:"perp-clearinghouse"},
    {contractId:"INVALID"},
    {owner:"NOT_A_WALLET"},
    {constructorOwner:"NOT_A_WALLET"},
    {deploymentTxHash:"z".repeat(64)},
    {wasmUploadTxHash:candidate.deploymentTxHash},
    {deploymentLedger:5506304},
    {wasmUploadLedger:0},
    {adminVerified:"yes"},
    {pausedVerified:null},
    {onchainCodeHashVerified:1},
    {deploymentXdrLinked:"success"},
    {reportedWasmFileSha256:"0x123"}
  ];
  for(const change of changes)assert.throws(()=>inspectM9Candidate({...candidate,...change}));
  assert.throws(()=>inspectM9Candidate({...candidate,privateKey:"S_DO_NOT_ACCEPT"}));
});

test("candidate rejects getters without executing them, symbols and inherited fields",()=>{
  let calls=0;
  const hostile={...candidate};
  Object.defineProperty(hostile,"owner",{enumerable:true,get(){calls++;throw Error("executed getter");}});
  assert.throws(()=>inspectM9Candidate(hostile),/exact public evidence schema/);
  assert.equal(calls,0);
  const symbolInput={...candidate,[Symbol("hidden")]:true};
  assert.throws(()=>inspectM9Candidate(symbolInput),/exact public evidence schema/);
  const inherited=Object.create({...candidate});
  assert.throws(()=>inspectM9Candidate(inherited),/exact public evidence schema/);
});
