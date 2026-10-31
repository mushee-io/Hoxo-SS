#!/usr/bin/env node
/**
 * M4 live external check. Read-only; fails closed. No deployments or funds.
 * Run: npm run check:infra
 * Optional secure HTTPS overrides: HOXO_TESTNET_RPC_URL, HOXO_TESTNET_HORIZON_URL
 */
import {makeTestnetConfig,TESTNET_CONFIG} from "../config/testnet.mjs";
import {probeInfrastructure} from "../infra/network.mjs";
import {validateRegistry} from "../infra/registry.mjs";
import {readFile} from "node:fs/promises";
const config=makeTestnetConfig({
  horizon:process.env.HOXO_TESTNET_HORIZON_URL||TESTNET_CONFIG.horizon,
  rpc:process.env.HOXO_TESTNET_RPC_URL||TESTNET_CONFIG.rpc
});
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const summary=validateRegistry(registry);
console.log("Network:",config.network);
console.log("Passphrase:",config.passphrase);
console.log("Horizon:",config.horizon);
console.log("RPC:",config.rpc);
console.log("Registry:",summary.assetCount,"assets;",summary.contractCount,"planned/candidate contract roles;",summary.deployedVerified,"verified deployments");
const result=await probeInfrastructure({config,timeoutMs:15_000});
console.log("Horizon:",result.horizon.state,result.horizon.ledger??"—",result.horizon.message);
console.log("RPC:",result.rpc.state,result.rpc.ledger??"—",result.rpc.message);
console.log("Network reconciliation:",result.state,"ledger difference:",result.ledgerDelta??"—");
console.log(result.message);
if(result.state!=="verified")process.exitCode=1;
