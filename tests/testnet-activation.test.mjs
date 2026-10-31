import test from "node:test";
import assert from "node:assert/strict";
import {
  AUXILIARY_TESTNET_PACKAGES,ALL_TESTNET_OPERATOR_PACKAGES,
  validateTestnetOperatorConfig,prepareTestnetDeployment,
  prepareTestnetRiskBinding,operatorBindTestnetRisk,
  DEPLOY_ACK,isStellarCAddress,
} from "../deployment/testnet-operator.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {readFile} from "node:fs/promises";

const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function address(version,byte){
  const bytes=[version,...Array(32).fill(byte)];
  let crc=0;
  for(const n of bytes){
    crc^=n<<8;
    for(let i=0;i<8;i++)
      crc=crc&0x8000?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  bytes.push(crc&255,crc>>8);
  let bits=0,acc=0,out="";
  for(const b of bytes){
    acc=(acc<<8)|b;bits+=8;
    while(bits>=5){bits-=5;out+=alphabet[(acc>>>bits)&31];acc&=(1<<bits)-1;}
  }
  if(bits)out+=alphabet[(acc<<(5-bits))&31];
  return out;
}
const G=address(48,1),C=n=>address(16,n);
const config={
  network:"testnet",networkPassphrase:TESTNET_PASSPHRASE,
  sourceAlias:"hoxo_operator_external",adminPublicKey:G,
  valuelessTokenContract:C(2),riskVaultContract:C(3),riskOracleContract:C(4),
  moneyMarketContract:C(5),perpClearinghouseContract:C(6),
  spotSettlementContract:C(7),portfolioAccountingContract:C(8),
  riskEngineContract:C(9)
};
test("the 7 canonical Hoxo packages and two auxiliary packages have distinct immutable roles",()=>{
  assert.equal(AUXILIARY_TESTNET_PACKAGES.length,2);
  assert.equal(ALL_TESTNET_OPERATOR_PACKAGES.length,9);
  assert.equal(new Set(ALL_TESTNET_OPERATOR_PACKAGES.map(x=>x.role)).size,9);
  for(const v of Object.values(config))if(typeof v==="string"&&v.startsWith("C"))
    assert.equal(isStellarCAddress(v),true);
  assert.equal(validateTestnetOperatorConfig(config).network,"testnet");
});
test("portfolio-accounting and custody-router constructor CLI dry runs bind identical verified Testnet token",()=>{
  const observer=prepareTestnetDeployment(config,"portfolio-accounting");
  assert.deepEqual(observer.args.slice(-10),[
    "--admin",G,"--vault",C(3),"--lending",C(5),
    "--perp",C(6),"--asset",C(2)]);
  const router=prepareTestnetDeployment(config,"custody-router");
  assert.deepEqual(router.args.slice(-12),[
    "--admin",G,"--vault",C(3),"--spot",C(7),
    "--lending",C(5),"--perp",C(6),"--asset",C(2)]);
  for(const item of [observer,router]){
    assert.equal(item.contractId,null);
    assert.equal(item.receiptVerified,false);
    assert.equal(item.financialBetaApproved,false);
    assert.equal(item.codeAudited,false);
    assert.ok(item.args.includes("testnet"));
    assert.ok(!item.args.includes("mainnet"));
    assert.ok(item.args.some(x=>x.endsWith("/"+item.wasm)));
  }
});
test("unverified/wrong/duplicate contracts and mainnet configuration never construct a deployment",()=>{
  for(const bad of [
    {...config,network:"mainnet"},
    {...config,networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {...config,sourceAlias:"S"+"A".repeat(55)},
    {...config,moneyMarketContract:C(3)},
    {...config,perpClearinghouseContract:C(5)},
    {...config,spotSettlementContract:C(2)},
    {...config,portfolioAccountingContract:G},
    {...config,perpClearinghouseContract:G}
  ]){
    const role=Object.hasOwn(bad,"spotSettlementContract")&&
      bad.spotSettlementContract!==config.spotSettlementContract?"custody-router":"portfolio-accounting";
    assert.throws(()=>prepareTestnetDeployment(bad,role));
  }
  assert.throws(()=>prepareTestnetDeployment(config,"unsafe-mainnet-aux"));
});
test("canonical-risk immutable binding includes all three separately verified product sources",()=>{
  const b=prepareTestnetRiskBinding(config);
  assert.deepEqual(b.args,[
    "contract","invoke","--id",C(9),"--source-account",
    "hoxo_operator_external","--network","testnet","--send=yes","--",
    "bind_products","--portfolio",C(8),"--lending",C(5),"--perp",C(6)
  ]);
  assert.equal(b.transactionSubmitted,false);
  assert.equal(b.receiptVerified,false);
  assert.equal(b.leverageApproved,false);
  assert.equal(b.financialBetaApproved,false);
  assert.equal(b.mainnetApproved,false);
  assert.ok(!b.args.includes("pause"));
  assert.ok(!b.args.includes("open"));
});
test("risk binding rejects unsupported and maliciously reused source addresses",()=>{
  for(const bad of [
    {...config,riskEngineContract:C(5)},
    {...config,riskEngineContract:C(2)},
    {...config,portfolioAccountingContract:C(6)},
    {...config,portfolioAccountingContract:G},
    {...config,moneyMarketContract:"fake"},
    {...config,network:"mainnet"},
    {...config,networkPassphrase:"not-testnet"}
  ])assert.throws(()=>prepareTestnetRiskBinding(bad));
});
test("no unauthorised signing in CI, missing operator acknowledgement or offline network",async()=>{
  let executed=0;
  const mock={config,
    executor:async()=>{executed++;return 0;},
    probe:async()=>({state:"verified",rpc:{state:"verified"},horizon:{state:"verified"}})};
  await assert.rejects(()=>operatorBindTestnetRisk(mock),/interactive acknowledgement/);
  await assert.rejects(()=>operatorBindTestnetRisk({
    ...mock,acknowledgement:DEPLOY_ACK,interactive:true,isCI:true
  }),/CI prohibited/);
  await assert.rejects(()=>operatorBindTestnetRisk({
    ...mock,acknowledgement:DEPLOY_ACK,interactive:true,
    probe:async()=>({state:"unavailable",rpc:{state:"mismatch"},horizon:{state:"verified"}})
  }),/preflight failed/);
  assert.equal(executed,0);
});
test("a mock CLI success can NEVER be described as an independently verified receipt",async()=>{
  let executed=0;
  const binding=await operatorBindTestnetRisk({
    config,acknowledgement:DEPLOY_ACK,interactive:true,isCI:false,
    executor:async(bin,args)=>{
      executed++;
      assert.equal(bin,"stellar");
      assert.ok(args.includes("bind_products"));
      assert.ok(args.includes("testnet"));
      return 0;
    },
    probe:async()=>({state:"verified",rpc:{state:"verified"},horizon:{state:"verified"}})
  });
  assert.equal(executed,1);
  assert.equal(binding.receiptVerified,false);
  assert.equal(binding.financialBetaApproved,false);
  assert.equal(binding.leverageApproved,false);
  assert.equal(binding.mainnetApproved,false);
  assert.equal(binding.transactionSubmitted,
    "CLI_REPORTED_SUCCESS_NOT_INDEPENDENTLY_VERIFIED");
});
test("source-only handoff never self-edits the canonical registry or fabricates a deployed Hoxo role",async()=>{
  const r=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  assert.ok(r.contracts.every(x=>x.status==="planned"&&x.contractId===null&&
    x.deploymentTxHash===null));
  const source=await readFile(new URL("../contracts/canonical-risk/src/lib.rs",import.meta.url),"utf8");
  assert.ok(source.includes("pub fn bind_products("));
  assert.ok(source.includes("pub fn approve_borrow("));
  assert.ok(source.includes("pub fn approve_open("));
  assert.ok(source.includes(")->bool{false}"));
});
