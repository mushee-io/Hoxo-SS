#!/usr/bin/env node
/** Deterministic offline incident drill, no on-chain permissions. */
import {simulateM24Incident,M24_INCIDENT_TYPES} from "../mainnet/incident.mjs";
const args=process.argv.slice(2);
if(args.length!==1)
  throw Error("Usage: npm run m24:drill -- <"+M24_INCIDENT_TYPES.join("|")+">");
console.log(JSON.stringify(simulateM24Incident(args[0]),null,2));
