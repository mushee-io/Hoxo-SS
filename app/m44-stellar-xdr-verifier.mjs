/**
 * M44 — OFFLINE, NON-BROADCASTING Stellar SDK/XDR checks for one exact M9
 * bilateral spot settlement. No RPC writes, secrets or sendTransaction calls.
 *
 * Requires a previously independently simulated source envelope and its one
 * taker auth entry. This module never simulates a trade on its own, never signs,
 * never unpauses, and never reports executionPermitted:true.
 */
import {
  TransactionBuilder, Operation, Address, Keypair, hash, scValToNative,
  inspectAuthEntry, checkAuthEntryReadiness, buildAuthorizationEntryPreimage, xdr
} from "@stellar/stellar-sdk";
import {TESTNET_PASSPHRASE, M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";

export const M44_XLM_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const M44_USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const KEYS=["match_id","maker_order_id","taker_order_id","maker","taker",
  "base_token","quote_token","base_amount","quote_amount","maker_side",
  "maker_limit_e7","taker_limit_e7","expires_at_ledger"];
const IDS=new Set(["match_id","maker_order_id","taker_order_id"]);
const INTS=new Set(["base_amount","quote_amount","maker_limit_e7","taker_limit_e7"]);
const G=/^G[A-Z2-7]{55}$/;
function fail(reason){throw Error("M44 XDR: "+reason);}
function b64(value){if(typeof value!=="string"||value.length<12||value.length>300000)fail("XDR base64 expected");return value;}
function xdr64(value){return value.toXdr("base64");}
function equalBytes(a,b){return a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((v,i)=>v===b[i]);}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
function address(input){if(typeof input!=="string"||!G.test(input))fail("valid public G-account required");return input;}
function ledgerNumber(n){
  if(!Number.isSafeInteger(n)||n<1||n>0xffffffff-101)fail("live Stellar ledger sequence required");
  return n;
}
function decodeSource(xdrText){
  let tx;
  try{tx=TransactionBuilder.fromXdr(b64(xdrText),TESTNET_PASSPHRASE);}
  catch{fail("invalid signed/unsigned transaction envelope XDR");}
  if(!Array.isArray(tx.operations)||tx.operations.length!==1)fail("exactly one operation required");
  const op=tx.operations[0];
  if(op.type!=="invokeHostFunction"||!op.func||op.func.type!=="hostFunctionTypeInvokeContract")
    fail("only M9 invokeHostFunction contract call permitted");
  const invoke=op.func.invokeContract;
  if(!invoke||Address.fromScAddress(invoke.contractAddress).toString()!==M9_TESTNET_CONTRACT_ID||
      String(invoke.functionName)!=="settle")fail("contract/method must be M9 settle");
  if(op.source!=null&&op.source!==tx.source)fail("operation source override prohibited");
  if(!Array.isArray(invoke.args)||invoke.args.length!==1)fail("one exact MatchTerms argument required");
  return {tx,op,invoke};
}
function readTerms(invoke){
  const scv=invoke.args[0];
  if(scv.type!=="scvMap")fail("MatchTerms must be Soroban map");
  const raw=scv.value??[];
  if(raw.length!==KEYS.length)fail("MatchTerms field count mismatch");
  const obj=Object.create(null);
  for(const item of raw){
    if(item.key.type!=="scvSymbol")fail("MatchTerms keys must be symbols");
    const key=String(item.key.value);
    if(!KEYS.includes(key)||Object.prototype.hasOwnProperty.call(obj,key))fail("unexpected or duplicate MatchTerms field");
    if(IDS.has(key)&&item.val.type!=="scvBytes")fail(key+" must be bytes");
    if(INTS.has(key)&&item.val.type!=="scvI128")fail(key+" must be i128");
    if(["maker","taker","base_token","quote_token"].includes(key)&&item.val.type!=="scvAddress")fail(key+" must be address");
    if(["maker_side","expires_at_ledger"].includes(key)&&item.val.type!=="scvU32")fail(key+" must be u32");
    const val=scValToNative(item.val);
    obj[key]=IDS.has(key)?hex(val):INTS.has(key)?BigInt(val).toString():val;
  }
  for(const key of KEYS)if(!(key in obj))fail("missing MatchTerms field: "+key);
  return obj;
}
function verifyExpectedTerms(actual,expected,now){
  if(!expected||Object.getPrototypeOf(expected)!==Object.prototype||
     Object.keys(expected).length!==KEYS.length)fail("exact reviewed MatchTerms required");
  for(const key of KEYS){
    if(!Object.prototype.hasOwnProperty.call(expected,key)||String(actual[key])!==String(expected[key]))
      fail("signed operation diverges from reviewed MatchTerms: "+key);
  }
  if(actual.base_token!==M44_XLM_SAC||actual.quote_token!==M44_USDC_SAC)fail("wrong Testnet XLM/USDC assets");
  if(!address(actual.maker)||!address(actual.taker)||actual.maker===actual.taker)fail("maker and taker must differ");
  for(const key of IDS)if(!/^[a-f0-9]{64}$/.test(actual[key]))fail("bad 32-byte "+key);
  if(actual.maker_order_id===actual.taker_order_id)fail("order IDs must differ");
  const base=BigInt(actual.base_amount), quote=BigInt(actual.quote_amount);
  const makerLimit=BigInt(actual.maker_limit_e7),takerLimit=BigInt(actual.taker_limit_e7);
  const max=1000000000000000n, priceMax=10000000000000000n;
  if(base<=0n||quote<=0n||base>max||quote>max||
      makerLimit<=0n||takerLimit<=0n||makerLimit>priceMax||takerLimit>priceMax)
    fail("amount or limit exceeds M9 bounds");
  if(![0,1].includes(actual.maker_side))fail("invalid maker side");
  const paid=quote*10000000n;
  if(actual.maker_side===0?(paid<base*makerLimit||paid>base*takerLimit):
      (paid>base*makerLimit||paid<base*takerLimit))fail("bilateral price limit violation");
  if(actual.expires_at_ledger<now||actual.expires_at_ledger>now+100)
    fail("settlement deadline stale or too far ahead");
}
/** Fail-closed fee classification; never authorises a signature or transaction. */
export function classifyM65SimulationFee(observedStroops, configuredStroops=1000000n){
  // BigInt() coerces booleans, null, arrays and objects. A fee policy must
  // instead be an exact, explicitly typed nonnegative integer.
  const exact=value=>typeof value==="bigint"||
    (typeof value==="number"&&Number.isSafeInteger(value))||
    (typeof value==="string"&&/^(?:0|[1-9]\d*)$/.test(value));
  if(!exact(observedStroops)||!exact(configuredStroops))
    return Object.freeze({allowed:false,reason:"invalid_fee"});
  let observed,configured;
  try{observed=BigInt(observedStroops);configured=BigInt(configuredStroops);}
  catch{return Object.freeze({allowed:false,reason:"invalid_fee"});}
  if(observed<100n||configured<100n||configured>10000000n)
    return Object.freeze({allowed:false,reason:"invalid_fee",observedStroops:observed.toString(),configuredStroops:configured.toString()});
  return Object.freeze({allowed:observed<=configured,reason:observed>configured?"fee_exceeds_ceiling":"within_ceiling",observedStroops:observed.toString(),configuredStroops:configured.toString()});
}
export function reviewM44SourceEnvelope({sourceTxXdr,expectedTerms,currentLedger,maxFeeStroops=1000000n}){
  const now=ledgerNumber(currentLedger);
  const {tx,op,invoke}=decodeSource(sourceTxXdr);
  if(tx.source!==expectedTerms?.maker)fail("maker must be transaction source");
  if(tx.signatures.length!==0)fail("expected unsigned source envelope");
  const fee=BigInt(tx.fee);
  if(!classifyM65SimulationFee(fee,maxFeeStroops).allowed)
    fail("transaction fee exceeds configured ceiling (observed "+fee.toString()+" stroops; configured "+BigInt(maxFeeStroops).toString()+" stroops; hard maximum 10000000 stroops)");
  const actual=readTerms(invoke);
  verifyExpectedTerms(actual,expectedTerms,now);
  const entries=op.auth??[];
  if(entries.length<1||entries.length>2)fail("simulated source envelope must contain taker auth");
  let sourceCount=0,takerCount=0;
  for(const entry of entries){
    const info=inspectAuthEntry(entry);
    if(info.credentialType==="sourceAccount")sourceCount++;
    else if(["address","addressV2"].includes(info.credentialType)&&
            info.address===actual.taker&&!info.signed)takerCount++;
    else fail("unexpected source envelope authorization");
  }
  if(takerCount!==1||sourceCount>1)fail("expected exact source/taker simulation authorization set");
  // Never accept an arbitrary independent auth tree: it must have come from
  // the exact reviewed simulated M9 operation.
  return Object.freeze({maker:actual.maker,taker:actual.taker,matchId:actual.match_id,
    argsXdr:xdr64(invoke.args[0]),invocationXdr:xdr64(invoke),feeStroops:fee.toString(),
    network:"Stellar Testnet",reviewed:true,verified:false,broadcast:false});
}
export function verifyM44TakerAuth({sourceTxXdr,takerAuthXdr,signedTakerAuthEntry,
  expectedTerms,currentLedger,maxFeeStroops=1000000n}){
  const now=ledgerNumber(currentLedger);
  reviewM44SourceEnvelope({sourceTxXdr,expectedTerms,currentLedger:now,maxFeeStroops});
  const {invoke,op}=decodeSource(sourceTxXdr);
  let unsigned,signed;
  try{
    unsigned=xdr.SorobanAuthorizationEntry.fromXdr(b64(takerAuthXdr),"base64");
    signed=xdr.SorobanAuthorizationEntry.fromXdr(b64(signedTakerAuthEntry),"base64");
  }catch{fail("malformed Soroban authorization XDR");}
  const simulatedAuth=(op.auth??[]).filter(entry=>inspectAuthEntry(entry).address===expectedTerms.taker);
  if(simulatedAuth.length!==1||xdr64(simulatedAuth[0])!==xdr64(unsigned))
    fail("unsigned taker auth entry does not match simulation");
  const u=inspectAuthEntry(unsigned),s=inspectAuthEntry(signed);
  if(!["address","addressV2"].includes(s.credentialType)||s.credentialType!==u.credentialType)
    fail("unsupported or substituted Soroban credential");
  if(u.address!==expectedTerms.taker||s.address!==expectedTerms.taker||
      s.nonce!==u.nonce||s.nonce===null)fail("taker credential address or nonce changed");
  if(u.signed)fail("unsigned auth entry unexpectedly signed");
  if(s.signatureExpirationLedger===null||s.signatureExpirationLedger<=now||
      s.signatureExpirationLedger>now+100)fail("taker auth expiry invalid");
  if(u.signatureExpirationLedger!==0&&u.signatureExpirationLedger!==s.signatureExpirationLedger)
    fail("taker auth expiry unexpectedly changed");
  if(xdr64(unsigned.rootInvocation)!==xdr64(signed.rootInvocation))
    fail("signed auth invocation tree diverged from simulation");
  const root=signed.rootInvocation;
  if(root.function.type!=="sorobanAuthorizedFunctionTypeContractFn"||
      xdr64(root.function.contractFn)!==xdr64(invoke))fail("taker auth root is not exact M9 settle invocation");
  if(!checkAuthEntryReadiness(signed,now).ready||!s.signed)
    fail("taker authorization unsigned or expired");
  if(s.signers.length!==1||s.signers[0].address!==expectedTerms.taker||
      !Array.isArray(s.signers[0].signatures)||s.signers[0].signatures.length!==1||
      s.signers[0].signatures[0].publicKey!==expectedTerms.taker)
    fail("expected exactly one standard taker Ed25519 signature");
  const preimage=buildAuthorizationEntryPreimage(signed,s.signatureExpirationLedger,TESTNET_PASSPHRASE);
  const signature=s.signers[0].signatures[0].signature;
  if(!Keypair.fromPublicKey(expectedTerms.taker).verify(hash(preimage.toXdr()),signature))
    fail("taker Ed25519 authorization signature invalid");
  return Object.freeze({credentialType:s.credentialType,signer:s.address,
    nonce:s.nonce.toString(),expirationLedger:s.signatureExpirationLedger,
    signatureVerified:true,invocationVerified:true,broadcast:false});
}
export function createM44EnvelopePreparer({expectedTerms,currentLedger,maxFeeStroops=1000000n,
  takerAuthXdr}){
  // Adapter callback for M43. Expected terms/ledger are independently reviewed
  // and supplied explicitly; NEVER inferred from an untrusted wallet prompt.
  return async ({sourceTxXdr,signedTakerAuthEntry,networkPassphrase,contractId,maker,taker,matchId})=>{
    if(networkPassphrase!==TESTNET_PASSPHRASE||contractId!==M9_TESTNET_CONTRACT_ID||
        maker!==expectedTerms.maker||taker!==expectedTerms.taker||matchId!==expectedTerms.match_id)
      fail("M43-to-M44 signer/contract/terms mismatch");
    verifyM44TakerAuth({sourceTxXdr,takerAuthXdr,signedTakerAuthEntry,
      expectedTerms,currentLedger,maxFeeStroops});
    const {tx,op}=decodeSource(sourceTxXdr);
    // v17 Transaction objects are immutable: REBUILD with exact same host
    // function, resources, fee, conditions and a SINGLE verified taker auth.
    const auth=xdr.SorobanAuthorizationEntry.fromXdr(signedTakerAuthEntry,"base64");
    const sourceAuth=(op.auth??[]).filter(a=>inspectAuthEntry(a).credentialType==="sourceAccount");
    const originalTaker=(op.auth??[]).filter(a=>inspectAuthEntry(a).address===expectedTerms.taker);
    if(sourceAuth.length>1||originalTaker.length!==1)fail("unexpected simulated auth entries");
    const replacements=(op.auth??[]).map(a=>
      inspectAuthEntry(a).address===expectedTerms.taker?auth:a);
    const prepared=TransactionBuilder.cloneFrom(tx,{fee:String(tx.fee)})
      .clearOperations()
      .addOperation(Operation.invokeHostFunction({source:op.source,func:op.func,auth:replacements}))
      .build();
    if(prepared.source!==expectedTerms.maker||prepared.operations.length!==1||
        prepared.operations[0].auth?.length!==(op.auth??[]).length)
      fail("prepared source envelope malformed");
    const preparedTxXdr=prepared.toXdr();
    if(preparedTxXdr===sourceTxXdr)fail("auth entry not attached");
    return {preparedTxXdr};
  };
}
export function verifyM44MakerEnvelope({preparedTxXdr,signedTxXdr,maker}){
  if(!address(maker))fail("maker address required");
  const a=decodeSource(preparedTxXdr).tx,b=decodeSource(signedTxXdr).tx;
  if(a.source!==maker||b.source!==maker)fail("source account mismatch");
  if(a.signatures.length!==0||b.signatures.length!==1)fail("expected only one maker envelope signature");
  if(!equalBytes(a.hash(),b.hash()))fail("signed transaction body diverged from prepared envelope");
  if((a.operations[0].auth?.length??0)<1||
      a.operations[0].auth?.length!==b.operations[0].auth?.length)
    fail("missing or changed taker authorization set");
  if(!Keypair.fromPublicKey(maker).verify(b.hash(),b.signatures[0].signature))
    fail("maker envelope signature invalid");
  return Object.freeze({maker,signatureVerified:true,transactionBodyVerified:true,
    network:"Stellar Testnet",broadcast:false,executionPermitted:false});
}
