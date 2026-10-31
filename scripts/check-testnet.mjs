#!/usr/bin/env node
/**
 * Real external-network smoke check against Stellar Testnet Horizon.
 * Read-only and without private keys. Intended for CI and local verification.
 */
import { probeTestnet, TESTNET } from "../assets/testnet-status.mjs";
const status=await probeTestnet({timeoutMs:15_000});
console.log("Horizon endpoint:",TESTNET.horizon);
console.log("Expected network:",TESTNET.passphrase);
console.log("Verification result:",status.state);
console.log(status.message);
if(status.state==="verified"){
  console.log("Latest verified ledger:",status.ledger);
  console.log("Last ledger close (UTC):",status.closeTime);
}else{
  process.exitCode=1;
}
