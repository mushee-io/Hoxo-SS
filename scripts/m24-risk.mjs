#!/usr/bin/env node
/** Local illustrative review of proposed parameters, never market risk approval. */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {evaluateM24ProposedRiskBudget} from "../mainnet/risk-budget.mjs";
const args=process.argv.slice(2);
if(args.length!==1||args[0].startsWith("--"))
  throw Error("Usage: npm run m24:risk -- /path/to/off-repo-risk-proposal.json");
const source=await readFile(resolve(args[0]),"utf8");
if(source.length>100_000)throw Error("M24 risk proposal exceeds 100KB");
const result=evaluateM24ProposedRiskBudget(JSON.parse(source));
console.log(JSON.stringify(result,null,2));
if(result.issues.length)process.exitCode=2;
