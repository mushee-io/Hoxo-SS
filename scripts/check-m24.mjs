#!/usr/bin/env node
/** Read-only mainnet no-go assessment, never deployment or approval. */
import {readFile} from "node:fs/promises";
import {m24Readiness,assertM24LaunchAuthorized} from "../mainnet/readiness.mjs";
const args=process.argv.slice(2);
if(args.length>1||args.some(x=>x!=="--require-go"))
  throw Error("Usage: npm run m24:readiness [-- --require-go]");
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const state=m24Readiness(registry);
console.log(JSON.stringify(state,null,2));
if(args.includes("--require-go"))assertM24LaunchAuthorized(registry);
