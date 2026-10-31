#!/usr/bin/env node
/**
 * M9: explicit two-wallet Stellar TESTNET settlement rehearsal.
 * Never broadcasts unless HOXO_M9_SEND is the exact explicit acknowledgement.
 * No wallet secrets are logged, stored, or sent to an external application.
 */
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {TESTNET_CONFIG,TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {validateSettlementTerms,m9TwoWalletSettlement,M9_SEND_ACK} from "../matching/m9-wallet-settlement.mjs";

const path=process.env.HOXO_M9_TERMS_FILE;
if(!path)throw Error("HOXO_M9_TERMS_FILE required; point to agreed MatchTerms JSON outside repository");
const terms=validateSettlementTerms(JSON.parse(await readFile(resolve(path),"utf8")));
const registry=JSON.parse(await readFile(new URL("../registry/testnet.json",import.meta.url),"utf8"));
const contractId=process.env.HOXO_M9_CONTRACT_ID;
if(!contractId)throw Error("HOXO_M9_CONTRACT_ID required and must match Testnet candidate in registry");
const intent=process.env.HOXO_M9_SEND||"";
if(intent&&intent!==M9_SEND_ACK)throw Error("Incorrect send acknowledgement; no transaction will be broadcast");
const send=intent===M9_SEND_ACK;
let sdk;
try{sdk=await import("@stellar/stellar-sdk");}
catch{throw Error("Install pinned @stellar/stellar-sdk using npm install before running M9");}
const makerSecret=process.env.HOXO_M9_MAKER_SECRET;
const takerSecret=process.env.HOXO_M9_TAKER_SECRET;
if(send&&(!makerSecret||!takerSecret))
  throw Error("Broadcast requires TWO independent private Testnet wallet signers in the process environment");
const source=makerSecret?sdk.Keypair.fromSecret(makerSecret):sdk.Keypair.fromPublicKey(terms.maker);
const other=takerSecret?sdk.Keypair.fromSecret(takerSecret):sdk.Keypair.fromPublicKey(terms.taker);
if(send&&(source.publicKey()!==terms.maker||other.publicKey()!==terms.taker))
  throw Error("Testnet signer keys do not own the exact maker/taker wallets");
const server=new sdk.rpc.Server(TESTNET_CONFIG.rpc);
const maxFee=BigInt(process.env.HOXO_M9_MAX_FEE_STROOPS||"1000000");
if(maxFee<100n||maxFee>10_000_000n)throw Error("M9 fee ceiling must be between 100 and 10,000,000 stroops");
const report=await m9TwoWalletSettlement({
  sdk,server,registry,contractId,terms,sourceKeypair:source,otherKeypair:other,
  rpcUrl:TESTNET_CONFIG.rpc,send,sendAcknowledgement:intent,maxFeeStroops:maxFee
});
console.log(JSON.stringify({
  ...report,networkPassphrase:TESTNET_PASSPHRASE,
  message:send?"Verify transaction hash and receipt independently. No unified-margin integration.":
    "PREVIEW ONLY: no spending signatures, no broadcast, and no live exchange execution."
},null,2));
