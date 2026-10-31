#!/usr/bin/env node
/**
 * Operator machine only. Review CLI output and exact deployed constructor args.
 * Use: npm run testnet:deploy -- <role> /path/to/keys-free-config.json
 * To ACTUALLY submit, operator must use --execute and the exact environment
 * acknowledgement; NEVER run this in CI or unattended automation.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {prepareTestnetDeployment,operatorDeployTestnet,DEPLOY_ACK} from "../deployment/testnet-operator.mjs";
const [role,path,execute,...extra]=process.argv.slice(2);
if(!role||!path||extra.length||(execute&&execute!=="--execute"))
  throw Error("Usage: npm run testnet:deploy -- <contract-role> /path/to/nonsecret-config.json [--execute]");
const raw=await readFile(resolve(path),"utf8");
if(raw.length>10000)throw Error("Testnet deployment JSON larger than 10KB");
const config=JSON.parse(raw);
const prepared=prepareTestnetDeployment(config,role);
if(execute!=="--execute"){
  console.log(JSON.stringify({...prepared,mode:"DRY_RUN_ONLY",source:"LOCAL_CONFIG_NOT_PROOF"},null,2));
}else{
  if(process.env.HOXO_TESTNET_OPERATOR_ACK!==DEPLOY_ACK)throw Error("Explicit HOXO_TESTNET_OPERATOR_ACK required");
  const result=await operatorDeployTestnet({
    config,role,acknowledgement:DEPLOY_ACK,interactive:Boolean(process.stdin.isTTY),
    isCI:Boolean(process.env.CI||process.env.GITHUB_ACTIONS),
    executor:async(bin,args)=>spawnSync(bin,args,{
      stdio:"inherit",shell:false,env:process.env,
    }).status??1,
  });
  console.log(JSON.stringify(result,null,2));
}
