/**
 * M9 — guarded Stellar TESTNET bilateral Soroban settlement.
 *
 * Uses the official @stellar/stellar-sdk Client.from + signAuthEntries flow.
 * No M8 Ed25519 order intent is treated as a wallet spending authorisation.
 * Never broadcasts by default. No secrets are stored or logged by this module.
 * A network-approved *candidate* contract must be in registry/testnet.json.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {isStellarContractId,validateRegistry} from "../infra/registry.mjs";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";

export const M9_SEND_ACK="I_ACCEPT_STELLAR_TESTNET_SETTLEMENT";
const FIELDS=["match_id","maker_order_id","taker_order_id","maker","taker",
  "base_token","quote_token","base_amount","quote_amount","maker_side",
  "maker_limit_e7","taker_limit_e7","expires_at_ledger"];
const BIG_LIMIT=1_000_000_000_000_000n;
const MAX_PRICE=10_000_000_000_000_000n;
const SCALE=10_000_000n;
function hex32(x,label){
  if(typeof x!=="string"||!/^[a-fA-F0-9]{64}$/.test(x))throw Error(label+" must be exactly 32 bytes as hex");
  return x.toLowerCase();
}
function positiveBigint(x,name,max){
  if(typeof x!=="string"||!/^[1-9]\d*$/.test(x))throw Error(name+" must be a positive integer string of 7-decimal minimal units");
  const n=BigInt(x);
  if(n>max)throw Error(name+" exceeds M9 contract bounds");
  return n;
}
export function validateSettlementTerms(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     JSON.stringify(Object.keys(input).sort())!==JSON.stringify([...FIELDS].sort()))
    throw Error("M9 terms must have exactly the 13 Soroban MatchTerms fields");
  const terms={...input};
  for(const key of ["match_id","maker_order_id","taker_order_id"]){
    terms[key]=hex32(terms[key],key);
  }
  if(terms.maker_order_id===terms.taker_order_id)throw Error("Matching order IDs must differ");
  if(!isStellarGAddress(terms.maker)||!isStellarGAddress(terms.taker)||terms.maker===terms.taker)
    throw Error("Distinct valid Stellar G-account participants required");
  if(!isStellarContractId(terms.base_token)||!isStellarContractId(terms.quote_token)||
     terms.base_token===terms.quote_token)throw Error("Distinct valid Stellar token contract IDs required");
  const base=positiveBigint(terms.base_amount,"base_amount",BIG_LIMIT);
  const quote=positiveBigint(terms.quote_amount,"quote_amount",BIG_LIMIT);
  const maker=positiveBigint(terms.maker_limit_e7,"maker_limit_e7",MAX_PRICE);
  const taker=positiveBigint(terms.taker_limit_e7,"taker_limit_e7",MAX_PRICE);
  if(!Number.isSafeInteger(terms.maker_side)||![0,1].includes(terms.maker_side))
    throw Error("maker_side must be 0 (sell base) or 1 (buy base)");
  if(!Number.isSafeInteger(terms.expires_at_ledger)||terms.expires_at_ledger<1||
     terms.expires_at_ledger>4_294_967_295)throw Error("Invalid u32 expiry ledger");
  const paid=quote*SCALE, makerLimit=base*maker, takerLimit=base*taker;
  if(terms.maker_side===0?(paid<makerLimit||paid>takerLimit):(paid>makerLimit||paid<takerLimit))
    throw Error("Fill violates bilateral maker/taker limit prices");
  return Object.freeze(terms);
}
export function toContractTerms(input){
  const t=validateSettlementTerms(input);
  const out={...t};
  for(const key of ["match_id","maker_order_id","taker_order_id"]){
    out[key]=Uint8Array.from(Buffer.from(t[key],"hex"));
  }
  for(const key of ["base_amount","quote_amount","maker_limit_e7","taker_limit_e7"]){
    out[key]=BigInt(t[key]);
  }
  return out;
}
export function requireCandidateSpotRegistry(registry,contractId){
  const validated=validateRegistry(registry);
  const spot=validated.statuses.find(x=>x.role==="spot-settlement");
  const registered=registry.contracts.find(c=>c.role==="spot-settlement");
  if(!isStellarContractId(contractId)||spot?.status!=="candidate"||
     spot.contractId!==contractId||!registered?.deploymentTxHash||
     !registered.verifiedAtLedger){
    throw Error("M9 contract must have matching candidate ID and genuine Testnet deployment evidence in registry");
  }
  return true;
}
const asBig=(x,label)=>{
  try{return BigInt(x);}catch{throw Error(label+" did not return an integer");}
};
async function queryRead(server,contractId,method,args){
  const result=await server.queryContract(contractId,method,args);
  if(!result||result.isReadCall!==true)throw Error("M9 RPC "+method+" did not prove a read-only contract query");
  return result.result;
}
function checkedNetwork(rpcNetwork){
  if(rpcNetwork?.passphrase!==TESTNET_PASSPHRASE)
    throw Error("M9 RPC did not prove canonical Stellar Testnet passphrase");
}
export async function m9OnchainPreflight({server,contractId,terms,registry}){
  const t=validateSettlementTerms(terms);
  requireCandidateSpotRegistry(registry,contractId);
  checkedNetwork(await server.getNetwork());
  const latest=await server.getLatestLedger();
  const ledger=Number(latest?.sequence);
  if(!Number.isSafeInteger(ledger)||ledger<1||
     t.expires_at_ledger<ledger||t.expires_at_ledger-ledger>100){
    throw Error("M9 settlement deadline must be within the next 100 current Testnet ledgers");
  }
  const methods=await server.getContractMethods(contractId);
  const available=new Set(Array.isArray(methods)?methods.map(m=>m.name):[]);
  if(!["settle","receipt","is_settled","paused","allowed"].every(m=>available.has(m)))
    throw Error("M9 contract interface is missing required settlement methods");
  if(await queryRead(server,contractId,"paused")!==false)
    throw Error("M9 spot settlement contract is paused");
  if(await queryRead(server,contractId,"is_settled",{match_id:Uint8Array.from(Buffer.from(t.match_id,"hex"))})!==false)
    throw Error("M9 match ID is already settled or on-chain replay state is uncertain");
  for(const tokenId of [t.base_token,t.quote_token]){
    const enabled=await queryRead(server,contractId,"allowed",{asset:tokenId});
    if(enabled!==true)throw Error("M9 token is not approved on-chain: "+tokenId);
    const decimal=await queryRead(server,tokenId,"decimals");
    if(decimal!==7&&decimal!==7n)throw Error("M9 token does not have 7 decimals: "+tokenId);
  }
  const baseFrom=t.maker_side===0?t.maker:t.taker;
  const quoteFrom=t.maker_side===0?t.taker:t.maker;
  const baseAvailable=asBig(await queryRead(server,t.base_token,"balance",{id:baseFrom}),"Base token balance");
  const quoteAvailable=asBig(await queryRead(server,t.quote_token,"balance",{id:quoteFrom}),"Quote token balance");
  if(baseAvailable<BigInt(t.base_amount)||quoteAvailable<BigInt(t.quote_amount))
    throw Error("M9 transfer source has insufficient approved Testnet token balance");
  return Object.freeze({
    state:"PREFLIGHT_VERIFIED",ledger,contractId,
    maker:t.maker,taker:t.taker,
    matchId:t.match_id,baseToken:t.base_token,quoteToken:t.quote_token,
    baseAmount:t.base_amount,quoteAmount:t.quote_amount,
    // Preflight does NOT grant a margin reservation or approve a trade.
    walletSignaturesApplied:false,network:"Stellar Testnet",
    executionPermitted:false
  });
}
export function assertTxShape(assembled,maxFeeStroops=1_000_000n){
  if(!assembled||assembled.isReadCall!==false||!assembled.built)
    throw Error("M9 expected a simulated mutable Soroban transaction");
  const operations=assembled.built.operations;
  if(!Array.isArray(operations)||operations.length!==1||
     operations[0]?.type!=="invokeHostFunction")
    throw Error("M9 transaction must contain only one Soroban invokeHostFunction");
  const fee=asBig(assembled.built.fee,"Soroban transaction fee");
  if(fee<=0n||fee>maxFeeStroops)
    throw Error("M9 simulated fee exceeds the configured fee ceiling");
  return fee;
}
function normaliseHash(v){
  if(typeof v==="string"&&/^[0-9a-fA-F]{64}$/.test(v))return v.toLowerCase();
  if(v instanceof Uint8Array&&v.length===32)return Buffer.from(v).toString("hex");
  return null;
}
export function checkM9Receipt(receipt,terms){
  const t=validateSettlementTerms(terms);
  if(!receipt||typeof receipt!=="object"||
     normaliseHash(receipt.match_id)!==t.match_id||
     normaliseHash(receipt.maker_order_id)!==t.maker_order_id||
     normaliseHash(receipt.taker_order_id)!==t.taker_order_id||
     receipt.maker!==t.maker||receipt.taker!==t.taker||
     receipt.base_token!==t.base_token||receipt.quote_token!==t.quote_token||
     asBig(receipt.base_amount,"Receipt base amount")!==BigInt(t.base_amount)||
     asBig(receipt.quote_amount,"Receipt quote amount")!==BigInt(t.quote_amount)||
     Number(receipt.maker_side)!==t.maker_side||
     !Number.isSafeInteger(Number(receipt.settled_ledger))||
     Number(receipt.settled_ledger)<1){
    throw Error("M9 chain receipt does not match exact bilateral signed terms");
  }
  return {verified:true,settledLedger:Number(receipt.settled_ledger)};
}
export async function m9TwoWalletSettlement({
  sdk,server,registry,contractId,terms,sourceKeypair,otherKeypair,
  rpcUrl=TESTNET_CONFIG.rpc,send=false,sendAcknowledgement="",
  maxFeeStroops=1_000_000n
}){
  const t=validateSettlementTerms(terms);
  if(!sdk?.contract?.Client?.from||!sdk.contract.basicNodeSigner||
     !sourceKeypair||!otherKeypair)throw Error("Official Stellar SDK and two wallet signers are required");
  if(sourceKeypair.publicKey()!==t.maker||otherKeypair.publicKey()!==t.taker)
    throw Error("M9 maker must be transaction source and taker must be the independent auth-entry signer");
  if(sourceKeypair.publicKey()===otherKeypair.publicKey())
    throw Error("M9 source and counterparty must be independent wallets");
  const proof=await m9OnchainPreflight({server,contractId,terms:t,registry});
  const {signTransaction}=sdk.contract.basicNodeSigner(sourceKeypair,TESTNET_PASSPHRASE);
  const client=await sdk.contract.Client.from({
    contractId,rpcUrl,networkPassphrase:TESTNET_PASSPHRASE,
    publicKey:t.maker,signTransaction
  });
  const tx=await client.settle({terms:toContractTerms(t)},{fee:"1000",timeoutInSeconds:60});
  const fee=assertTxShape(tx,maxFeeStroops);
  const needed=tx.needsNonInvokerSigningBy();
  if(!Array.isArray(needed)||needed.length!==1||needed[0]!==t.taker)
    throw Error("M9 simulated Soroban auth must require EXACTLY the taker as extra signer");
  const preview={
    ...proof,requiredNonInvoker:t.taker,
    maxFeeStroops:maxFeeStroops.toString(),
    simulatedFeeStroops:fee.toString(),
    status:"SIMULATED_ONLY",
    executionPermitted:false
  };
  if(!send)return preview;
  if(sendAcknowledgement!==M9_SEND_ACK)
    throw Error("Explicit Stellar Testnet settlement acknowledgement required before signing and sending");
  const {signAuthEntry}=sdk.contract.basicNodeSigner(otherKeypair,TESTNET_PASSPHRASE);
  await tx.signAuthEntries({address:t.taker,signAuthEntry});
  if(tx.needsNonInvokerSigningBy().length!==0)
    throw Error("M9 Soroban non-invoker authorisation is not complete");
  // Final signature is the maker/source's transaction-envelope signature.
  const sent=await tx.signAndSend();
  const response=sent?.getTransactionResponse;
  const hash=response?.hash||sent?.sendTransactionResponse?.hash||null;
  if(response?.status!=="SUCCESS"||typeof hash!=="string"||
     !/^[0-9a-fA-F]{64}$/.test(hash)){
    throw Error("Settlement may have been broadcast but final success was not independently confirmed. Tx: "+String(hash));
  }
  const readBack=await queryRead(server,contractId,"receipt",{match_id:Uint8Array.from(Buffer.from(t.match_id,"hex"))});
  const confirmed=checkM9Receipt(readBack,t);
  const isSettled=await queryRead(server,contractId,"is_settled",{match_id:Uint8Array.from(Buffer.from(t.match_id,"hex"))});
  if(isSettled!==true)throw Error("Confirmed transaction but on-chain match replay record is missing: "+hash);
  return {
    state:"CONFIRMED_ONCHAIN",transactionHash:hash.toLowerCase(),settledLedger:confirmed.settledLedger,
    contractId,matchId:t.match_id,network:"Stellar Testnet",
    walletSignaturesApplied:true,
    // Settled standalone wallet-to-wallet; NOT a unified margin trade.
    executionMode:"BILATERAL_WALLET_DVP",marginIntegrated:false
  };
}
