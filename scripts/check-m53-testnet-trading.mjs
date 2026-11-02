#!/usr/bin/env node
/**
 * M53 live read-only Stellar Testnet acceptance report.
 * Run: npm run check:testnet-trading
 * Writes machine-readable JSON and a GitHub-friendly Markdown checklist.
 *
 * Never signs, never submits, never deploys, never changes M9 pause.
 * Network error -> unverified checkboxes and a nonzero CI result.
 */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {probeM41SpotAssets} from "../activation/m41-spot-asset-readiness.mjs";
import {evaluateM53TestnetTrading,formatM53Markdown}
  from "../verification/m53-testnet-trading-checklist.mjs";

const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
let m41=null,probeError=null;
try{
  m41=await probeM41SpotAssets();
}catch(error){
  probeError=String(error?.message??error);
}
const report=evaluateM53TestnetTrading({m41,registry,probeError});
const outputDir=resolve(process.env.M53_OUTPUT_DIR||"testnet-checklist-report");
await mkdir(outputDir,{recursive:true});
await Promise.all([
  writeFile(resolve(outputDir,"testnet-trading.json"),JSON.stringify(report,null,2)+"\n"),
  writeFile(resolve(outputDir,"testnet-trading.md"),formatM53Markdown(report))
]);
console.log(formatM53Markdown(report));
console.log("JSON + Markdown checklist written to "+outputDir);
if(probeError){
  console.error("M53: live network could not be verified; all on-chain checks remain unchecked");
  process.exitCode=1;
}
// This is a READINESS report, not a zero-exit activation request. A paused
// contract or missing signed transaction is an expected, visible BLOCKED state.
