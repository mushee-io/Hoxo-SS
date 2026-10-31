import test from "node:test";
import assert from "node:assert/strict";
import {prepareTestnetDeployment,operatorDeployTestnet,
  isStellarCAddress,DEPLOY_ACK} from "../deployment/testnet-operator.mjs";
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {readFile} from "node:fs/promises";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function key(version,byte){
  const data=[version,...Array(32).fill(byte)];
  let crc=0;
  for(const n of data){crc^=n<<8;for(let i=0;i<8;i++)
    crc=(crc&32768)?(((crc<<1)^0x1021)&65535):((crc<<1)&65535);}
  data.push(crc&255,crc>>8);
  let v=0,bits=0,out="";
  for(const n of data){
    v=(v<<8)|n;bits+=8;
    while(bits>=5){bits-=5;out+=alphabet[(v>>>bits)&31];v&=(1<<bits)-1;}
  }
  if(bits)out+=alphabet[(v<<(5-bits))&31];
  return out;
}
const owner=key(48,1),a=key(48,2),b=key(48,3),token=key(16,4);
const config={network:"testnet",networkPassphrase:TESTNET_PASSPHRASE,
  sourceAlias:"hoxo_testnet_operator",adminPublicKey:owner,
  publisherA:a,publisherB:b,marketId:1,valuelessTokenContract:token,
  riskVaultContract:key(16,5),riskOracleContract:key(16,6),maxOwnerReservedE7:500000000};
test("testnet-only deployment manifest covers exact canonical 7 roles with safe constructor args",()=>{
  assert.equal(isStellarCAddress(token),true);
  assert.equal(isStellarCAddress(owner),false);
  for(const role of ["oracle-adapter","risk-engine","collateral-vault","spot-settlement",
    "money-market","perp-clearinghouse","unified-margin"]){
    const p=prepareTestnetDeployment(config,role);
    assert.equal(p.network,"testnet");
    assert.ok(p.args.includes("testnet"));
    assert.ok(!p.args.includes("mainnet"));
    assert.equal(p.transactionSubmitted,false);
    assert.equal(p.financialBetaApproved,false);
    assert.equal(p.contractId,null);
    assert.equal(p.sourceAlias,"hoxo_testnet_operator");
    assert.ok(p.args.some(arg=>arg.endsWith("/"+p.wasm)));
  }
  const risk=prepareTestnetDeployment(config,"risk-engine");
  assert.ok(risk.args.includes("--max-owner-reserved-e7"));
  assert.ok(risk.args.includes(config.riskVaultContract));
  assert.ok(risk.args.includes(config.riskOracleContract));
  assert.equal(risk.args[risk.args.length-1],"500000000");
  const oracle=prepareTestnetDeployment(config,"oracle-adapter");
  assert.deepEqual(oracle.args.slice(-8),
    ["--admin",owner,"--market-id","1","--publisher-a",a,"--publisher-b",b]);
});
test("strict Testnet and independent publisher validation rejects insecure config",()=>{
  for(const bad of [
    {...config,network:"mainnet"}, {...config,networkPassphrase:"Public Global Stellar Network ; September 2015"},
    {...config,sourceAlias:"S"+"A".repeat(55)},
    {...config,adminPublicKey:a,publisherA:a},
    {...config,publisherA:b},
    {...config,publisherB:a},
    {...config,marketId:0}, {...config,marketId:1.25},
  ])assert.throws(()=>prepareTestnetDeployment(bad,"oracle-adapter"));
  assert.throws(()=>prepareTestnetDeployment(config,"mainnet-bypass"));
  assert.throws(()=>prepareTestnetDeployment({...config,valuelessTokenContract:owner},"unified-margin"));
  assert.throws(()=>prepareTestnetDeployment({...config,riskVaultContract:owner},"risk-engine"));
  assert.throws(()=>prepareTestnetDeployment({...config,riskVaultContract:config.riskOracleContract},"risk-engine"));
  assert.throws(()=>prepareTestnetDeployment({...config,maxOwnerReservedE7:0},"risk-engine"));
});
test("actual Testnet deployment refuses no acknowledgement, CI and missing network verification",async()=>{
  let executed=0,probed=0;
  const mock={config,role:"oracle-adapter",
    executor:async()=>{executed++;return 0;},
    probe:async()=>{probed++;return {state:"verified",
      horizon:{state:"verified"},rpc:{state:"verified"}}}};
  await assert.rejects(()=>operatorDeployTestnet(mock),/interactive acknowledgement/);
  await assert.rejects(()=>operatorDeployTestnet({...mock,acknowledgement:DEPLOY_ACK,interactive:true,isCI:true}),
    /CI prohibited/);
  assert.equal(executed,0);assert.equal(probed,0);
  await assert.rejects(()=>operatorDeployTestnet({...mock,
    acknowledgement:DEPLOY_ACK,interactive:true,isCI:false,
    probe:async()=>({state:"unavailable",horizon:{state:"verified"},rpc:{state:"mismatch"}})}),
    /preflight failed/);
  assert.equal(executed,0);
});
test("a mocked successful CLI deployment cannot fabricate receipt, independent proof or beta approval",async()=>{
  let calls=0;
  const r=await operatorDeployTestnet({config,role:"oracle-adapter",
    acknowledgement:DEPLOY_ACK,interactive:true,isCI:false,
    probe:async()=>({state:"verified",horizon:{state:"verified"},rpc:{state:"verified"}}),
    executor:async(bin,args)=>{calls++;assert.equal(bin,"stellar");
      assert.ok(args.includes("testnet"));return 0;}
  });
  assert.equal(calls,1);
  assert.equal(r.receiptVerified,false);
  assert.equal(r.codeAudited,false);
  assert.equal(r.financialBetaApproved,false);
  assert.equal(r.contractId,null);
});
test("existing Testnet registry stays planned and refuses to invent deployed proof",async()=>{
  const r=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
  assert.ok(r.contracts.every(x=>x.status==="planned"&&x.contractId===null));
});
