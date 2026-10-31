#!/usr/bin/env node
/**
 * Testnet-only operator runbook. Dry-run by default. No seeds or automatic
 * deployment. The real immutable bind_products call requires a separate
 * funded/authorised admin signer in an external Stellar CLI identity store.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {
  DEPLOY_ACK,prepareTestnetRiskBinding,operatorBindTestnetRisk
} from "../deployment/testnet-operator.mjs";

const [path,execute,...extra]=process.argv.slice(2);
if(!path||extra.length||(execute&&execute!=="--execute"))
  throw Error("Usage: node scripts/bind-testnet-risk.mjs /path/to/public-only-config.json [--execute]");
const raw=await readFile(resolve(path),"utf8");
if(raw.length>10000)throw Error("Risk-binding config must be under 10KB");
const config=JSON.parse(raw);
const prepared=prepareTestnetRiskBinding(config);
if(execute!=="--execute"){
  console.log(JSON.stringify({...prepared,mode:"DRY_RUN_ONLY",
    source:"LOCAL_PUBLIC_CONFIG_NOT_ON_CHAIN_EVIDENCE"},null,2));
}else{
  if(process.env.HOXO_TESTNET_OPERATOR_ACK!==DEPLOY_ACK)
    throw Error("Exact HOXO_TESTNET_OPERATOR_ACK required");
  const result=await operatorBindTestnetRisk({
    config,acknowledgement:DEPLOY_ACK,
    interactive:Boolean(process.stdin.isTTY),
    isCI:Boolean(process.env.CI||process.env.GITHUB_ACTIONS),
    executor:async(bin,args)=>spawnSync(bin,args,{
      stdio:"inherit",shell:false,env:process.env
    }).status??1,
  });
  console.log(JSON.stringify(result,null,2));
}
