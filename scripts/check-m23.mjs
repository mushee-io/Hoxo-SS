#!/usr/bin/env node
/** M23 beta status; optional read-only network probe. No execution permissions. */
import {readFile} from "node:fs/promises";
import {m23Readiness,requireM23PublicBetaApproval} from "../beta/readiness.mjs";
import {m23StatusSnapshot} from "../beta/telemetry.mjs";
const args=process.argv.slice(2);
if(args.some(x=>!["--live","--require-open"].includes(x))||
   new Set(args).size!==args.length)
  throw Error("Usage: npm run m23:readiness [-- --live | --require-open]");
const registry=JSON.parse(await readFile(
  new URL("../registry/testnet.json",import.meta.url),"utf8"));
const readiness=m23Readiness(registry);
const status=await m23StatusSnapshot({registry,withNetwork:args.includes("--live")});
console.log(JSON.stringify({readiness,status},null,2));
if(args.includes("--require-open"))requireM23PublicBetaApproval(registry);
