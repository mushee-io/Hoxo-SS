#!/usr/bin/env node
/**
 * No keys, no writes and no broadcasting. Require external REAL Testnet
 * contract IDs, transaction hashes, and matching locally reviewed WASM.
 * All results are deliberately short of verified deployment/launch approval.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {verifyTestnetCode,createLiveCodeVerificationServer,
  validateTestnetCodeManifest} from "../verification/testnet-code.mjs";
const [manifestPath,wasmDirectory,...more]=process.argv.slice(2);
if(!manifestPath||!wasmDirectory||more.length)
  throw Error("Usage: npm run testnet:verify-code -- /private/public-ids-only.json ./target/wasm32v1-none/release");
const raw=await readFile(resolve(manifestPath),"utf8");
if(raw.length>15_000)throw Error("Testnet verification manifest over 15KB");
const manifest=JSON.parse(raw);
validateTestnetCodeManifest(manifest);
const sdk=await import("@stellar/stellar-sdk");
const server=await createLiveCodeVerificationServer({sdk});
const report=await verifyTestnetCode({manifest,wasmDirectory,server});
console.log(JSON.stringify(report,null,2));
if(!report.contracts.length||report.contracts.some(c=>!c.sourceAndOnchainCodeMatch))
  process.exitCode=1;
