#!/usr/bin/env node
/** Live read-only Testnet verification. NEVER signs, submits or unpauses. */
import {readM59VerifiedSpotActivity} from "../verification/m59-m9-ledger-activity.mjs";
const result=await readM59VerifiedSpotActivity();
console.log(JSON.stringify({
  scope:"bounded recent Stellar Testnet M9 ledger window",
  network:result.network,contract:result.contract,
  fromLedger:result.fromLedger,throughLedger:result.throughLedger,
  verifiedCount:result.verifiedCount,
  verifiedXlmVolumeE7:result.verifiedXlmVolumeE7,
  verifiedUsdcVolumeE7:result.verifiedUsdcVolumeE7,
  mayBeTruncated:result.mayBeTruncated,
  hashes:result.records.map(x=>x.transactionHash),
  unverifiedMarketVolumeNeverClaimed:true,
  transactionsSubmitted:0
},null,2));
