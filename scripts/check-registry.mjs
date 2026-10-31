#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {validateRegistry} from "../infra/registry.mjs";
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const summary=validateRegistry(registry);
console.log(JSON.stringify(summary,null,2));
console.log("Registry validated: metadata does NOT prove a contract was deployed.");
