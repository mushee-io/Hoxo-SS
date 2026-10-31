#!/usr/bin/env node
/** SHA256 inventory only. Never invokes Stellar CLI, keys or deployment. */
import {readFile} from "node:fs/promises";
import {m23DeploymentPlan} from "../beta/deployment-plan.mjs";
const args=process.argv.slice(2);
if(args.length!==1||args[0].startsWith("--"))
  throw Error("Usage: npm run m23:plan -- /absolute/local/path/to/reviewed/wasm");
const registry=JSON.parse(await readFile(
  new URL("../registry/testnet.json",import.meta.url),"utf8"));
const plan=await m23DeploymentPlan({
  wasmDirectory:args[0],registry,
  sourceRevision:process.env.HOXO_SOURCE_COMMIT||"UNSPECIFIED",
});
console.log(JSON.stringify(plan,null,2));
if(plan.missingArtifacts.length||plan.missingCanonicalOracle)process.exitCode=2;
