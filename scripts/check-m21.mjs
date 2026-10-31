#!/usr/bin/env node
/**
 * M21 CLI — read-only verification. No keys, signing, Friendbot or broadcasting.
 * Usage:
 *   node scripts/check-m21.mjs                      # blockers, no network request
 *   node scripts/check-m21.mjs /path/to/evidence.json # RPC receipts only
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {m21Readiness,validateM21Manifest,verifyM21Receipts,
  inspectM21Envelope,makeM21Rpc} from "../verification/m21.mjs";
const registry=JSON.parse(await readFile(
  new URL("../registry/testnet.json",import.meta.url),"utf8"));
if(process.argv.length===2){
  console.log(JSON.stringify(m21Readiness(registry),null,2));
}else if(process.argv.length===3){
  const raw=await readFile(resolve(process.argv[2]),"utf8");
  if(raw.length>100_000)throw Error("M21 evidence manifest exceeds 100KB");
  const manifest=JSON.parse(raw);
  validateM21Manifest(manifest,registry); // fail closed before ANY RPC requests
  const sdk=await import("@stellar/stellar-sdk");
  const report=await verifyM21Receipts({
    registry,manifest,rpc:makeM21Rpc(),
    inspectEnvelope:details=>inspectM21Envelope(sdk,details),
  });
  console.log(JSON.stringify(report,null,2));
}else{
  throw Error("Usage: node scripts/check-m21.mjs [external-evidence-manifest.json]");
}
