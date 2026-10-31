#!/usr/bin/env node
/** Strict local file hashes, never auditors' signatures or authority. */
import {readFile} from "node:fs/promises";
import {prepareM24EvidencePacket} from "../mainnet/evidence.mjs";
const args=process.argv.slice(2);
if(args.length!==1||args[0].startsWith("--"))
  throw Error("Usage: HOXO_SOURCE_COMMIT=<FULL_40_HEX_GIT_SHA> npm run m24:evidence -- /path/to/approved-off-repo-evidence");
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const packet=await prepareM24EvidencePacket({
  directory:args[0],registry,sourceRevision:process.env.HOXO_SOURCE_COMMIT,
});
console.log(JSON.stringify(packet,null,2));
if(packet.missing.length)process.exitCode=2;
