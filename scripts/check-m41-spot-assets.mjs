#!/usr/bin/env node
/**
 * M41 public-only Stellar Testnet asset and deployment probe.
 * SAFE for GitHub Actions. No signer, key, XDR, approvals, unpause or tx send.
 * Exit 0 with BLOCKED_FREIGHTER_ASSET_SETUP when operator actions are needed.
 * Fail closed on contract, network or public RPC validity mismatches.
 */
import {probeM41SpotAssets} from "../activation/m41-spot-asset-readiness.mjs";
try{
  const result=await probeM41SpotAssets();
  console.log(JSON.stringify(result,null,2));
}catch(err){
  console.error(JSON.stringify({
    milestone:"M41",state:"UNVERIFIED_READ_ONLY_NETWORK_OR_CONTRACT",
    executionPermitted:false,realTradingVerified:false,
    error:String(err?.message||err)
  },null,2));
  process.exitCode=1;
}
