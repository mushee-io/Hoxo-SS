#!/usr/bin/env node
/** M22 non-elevating audit status. --require-clearance intentionally exits nonzero. */
import {readFile} from "node:fs/promises";
import {m22AuditReadiness,assertM22ReleaseApproved} from "../security/m22-review.mjs";
const args=process.argv.slice(2);
if(args.length>1||args.some(x=>x!=="--require-clearance"))
  throw Error("Usage: npm run m22:readiness [-- --require-clearance]");
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const status=m22AuditReadiness(registry);
console.log(JSON.stringify(status,null,2));
if(args.includes("--require-clearance"))assertM22ReleaseApproved(registry);
