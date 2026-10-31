/**
 * M21 — independent read-only verification of operator-supplied Testnet receipts.
 *
 * A successful RPC observation is NOT a proven unified-margin workflow, oracle,
 * deployed-code audit, or safe custody. No secrets, no signing and NO sendTransaction.
 */
import {validateRegistry,isStellarContractId} from "../infra/registry.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";
import {validateIndexerNetwork} from "../indexer/rpc.mjs";

const HASH=/^[a-fA-F0-9]{64}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const fail=message=>{throw Error("M21: "+message);};
export const M21_STEPS=Object.freeze([
  {id:"vault-deposit",role:"collateral-vault",method:"deposit",signer:"maker"},
  {id:"spot-settle",role:"spot-settlement",method:"settle",signer:"maker"},
  {id:"lending-supply",role:"money-market",method:"supply",signer:"maker"},
  {id:"lending-borrow",role:"money-market",method:"borrow",signer:"borrower"},
  {id:"perp-deposit",role:"perp-clearinghouse",method:"deposit",signer:"maker"},
  {id:"perp-open",role:"perp-clearinghouse",method:"open",signer:"maker"},
  {id:"perp-liquidate",role:"perp-clearinghouse",method:"liquidate",signer:"keeper"},
  {id:"lending-repay",role:"money-market",method:"repay",signer:"borrower"},
  {id:"perp-withdraw",role:"perp-clearinghouse",method:"withdraw",signer:"maker"},
  {id:"lending-withdraw",role:"money-market",method:"withdraw",signer:"maker"},
  {id:"vault-withdraw",role:"collateral-vault",method:"withdraw",signer:"maker"},
].map(x=>Object.freeze(x)));
const WALLET_ROLES=["maker","taker","borrower","keeper"];
const REQUIRED_CONTRACT_ROLES=["collateral-vault","oracle-adapter","risk-engine",
  "spot-settlement","money-market","perp-clearinghouse","unified-margin"];
function exactKeys(value,fields,label){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...fields].sort()))
    fail(label+" has missing or unexpected fields");
}
function validateHash(hash,label){
  if(typeof hash!=="string"||!HASH.test(hash))fail(label+" must be 64 hex digits");
  return hash.toLowerCase();
}
function canonicalB64(value){
  return typeof value==="string"&&value.length>0&&value.length<=262_144&&
    B64.test(value)&&Buffer.from(value,"base64").toString("base64")===value;
}
export function m21Readiness(registry){
  const summary=validateRegistry(registry);
  const candidate=new Set(summary.statuses.filter(x=>x.status==="candidate").map(x=>x.role));
  const missing=REQUIRED_CONTRACT_ROLES.filter(x=>!candidate.has(x));
  return Object.freeze({
    state:"BLOCKED_PENDING_INDEPENDENT_TESTNET_DEPLOYMENTS",
    network:"STELLAR_TESTNET",
    registryOnlyCandidates:summary.candidateContracts,
    missingContractRoles:missing,
    independentlyVerifiedContracts:0,
    verifiedSignedTransactions:0,
    actualUnifiedMarginIntegration:false,
    riskOracleAudited:false,
    realAssetIssuerApproved:false,
    fullLifecycleVerified:false,
    noMainnetExecution:true,
    reason:missing.length?
      "Missing candidate deployment metadata for "+missing.join(", "):
      "Candidate metadata is not independent code/deployment or canonical risk-oracle proof",
  });
}
export function validateM21Manifest(manifest,registry){
  validateRegistry(registry);
  exactKeys(manifest,["schemaVersion","networkPassphrase","wallets","steps"],"manifest");
  if(manifest.schemaVersion!==1||manifest.networkPassphrase!==TESTNET_PASSPHRASE)
    fail("Stellar Testnet v1 evidence manifest required");
  exactKeys(manifest.wallets,WALLET_ROLES,"wallets");
  for(const role of WALLET_ROLES)
    if(!isStellarGAddress(manifest.wallets[role]))fail("Invalid "+role+" Stellar wallet");
  if(new Set(Object.values(manifest.wallets)).size!==WALLET_ROLES.length)
    fail("M21 requires four independent wallet addresses (maker, taker, borrower, keeper)");
  if(!Array.isArray(manifest.steps)||manifest.steps.length!==M21_STEPS.length)
    fail("All 11 ordered M21 lifecycle steps require real transaction evidence");
  const hashes=new Set();
  const steps=manifest.steps.map((item,i)=>{
    const expected=M21_STEPS[i];
    exactKeys(item,["id","transactionHash"],"step "+i);
    if(item.id!==expected.id)fail("Unexpected lifecycle order at step "+i);
    const transactionHash=validateHash(item.transactionHash,item.id+" transaction");
    if(hashes.has(transactionHash))fail("Repeated on-chain transaction receipt");
    hashes.add(transactionHash);
    return Object.freeze({...expected,transactionHash,
      expectedSigner:manifest.wallets[expected.signer]});
  });
  const contracts=new Map(registry.contracts.map(x=>[x.role,x]));
  for(const spec of M21_STEPS){
    const entry=contracts.get(spec.role);
    if(entry?.status!=="candidate"||!isStellarContractId(entry?.contractId)||
       !entry?.deploymentTxHash||!Number.isSafeInteger(entry.verifiedAtLedger))
      fail("Verified deployment candidate metadata missing for "+spec.role);
  }
  // The cross-product M21 gate also requires the risk, oracle and unified margin.
  for(const role of REQUIRED_CONTRACT_ROLES){
    if(contracts.get(role)?.status!=="candidate")
      fail("M21 still lacks deployment candidate "+role);
  }
  return Object.freeze({
    networkPassphrase:TESTNET_PASSPHRASE,
    wallets:Object.freeze({...manifest.wallets}),
    steps,
    contracts:Object.freeze(Object.fromEntries(REQUIRED_CONTRACT_ROLES.map(role=>
      [role,contracts.get(role).contractId]))),
  });
}
/**
 * XDR verification uses the pinned official Stellar SDK in the CLI. Verifies:
 * - network-domain transaction hash matches RPC claim
 * - real Ed25519 envelope signature of expected independent source wallet
 * - exactly one contract invocation of the required deployed candidate and method
 * Does NOT inspect all Soroban auth entries or prove asset/position deltas.
 */
export function inspectM21Envelope(sdk,{envelopeXdr,transactionHash,expectedSigner,contractId,method}){
  if(!canonicalB64(envelopeXdr))fail("Missing/malformed transaction envelope XDR");
  if(!sdk?.TransactionBuilder?.fromXDR||!sdk?.Keypair?.fromPublicKey||!sdk?.Address?.fromScAddress)
    fail("Pinned official Stellar SDK is required for cryptographic verification");
  let tx;
  try{tx=sdk.TransactionBuilder.fromXDR(envelopeXdr,TESTNET_PASSPHRASE);}
  catch{fail("Unable to decode transaction envelope as Stellar Testnet");}
  const hash=tx.hash?.();
  if(!Buffer.isBuffer(hash)||hash.toString("hex")!==transactionHash)
    fail("Transaction envelope hash does not match RPC receipt");
  if(tx.source!==expectedSigner||!Array.isArray(tx.signatures)||tx.signatures.length<1)
    fail("Expected exact independent wallet as transaction source");
  const signer=sdk.Keypair.fromPublicKey(expectedSigner);
  if(!tx.signatures.some(sig=>signer.verify(hash,sig.signature())))
    fail("Expected wallet Ed25519 transaction signature missing or invalid");
  if(!Array.isArray(tx.operations)||tx.operations.length!==1||
      tx.operations[0]?.type!=="invokeHostFunction")
    fail("Expected one Soroban contract invocation, no other operations");
  const func=tx.operations[0].func;
  if(func?.switch?.().name!=="hostFunctionTypeInvokeContract")
    fail("Not a Soroban contract call");
  const call=func.invokeContract();
  const address=sdk.Address.fromScAddress(call.contractAddress()).toString();
  const functionName=call.functionName().toString();
  if(address!==contractId||functionName!==method)
    fail("Transaction targeted wrong contract role or method");
  return Object.freeze({
    envelopeHashVerified:true,sourceWalletSignatureVerified:true,
    invocationTargetVerified:true,operationCount:1,
    expectedSigner,contractId,method,
    sorobanAdditionalSignerAuthVerified:false,
    financialStateVerified:false,
  });
}
export async function verifyM21Receipts({
  registry,manifest,rpc,inspectEnvelope,nowMs=Date.now(),
}){
  const plan=validateM21Manifest(manifest,registry);
  if(typeof rpc!=="function"||typeof inspectEnvelope!=="function")
    fail("Read-only RPC and cryptographic envelope inspector required");
  const [network,health,head]=await Promise.all([
    rpc("getNetwork",{}),rpc("getHealth",{}),rpc("getLatestLedger",{}),
  ]);
  const live=validateIndexerNetwork(network,health,head,nowMs);
  const collected=[];
  let previousLedger=0;
  for(const step of plan.steps){
    const candidate=registry.contracts.find(x=>x.role===step.role);
    const tx=await rpc("getTransaction",{hash:step.transactionHash});
    if(tx?.status!=="SUCCESS")fail(step.id+" transaction is "+String(tx?.status||"MISSING"));
    if(validateHash(tx.txHash,step.id+" RPC hash")!==step.transactionHash)
      fail(step.id+" RPC hash mismatch");
    if(!Number.isSafeInteger(tx.ledger)||tx.ledger<health.oldestLedger||
       tx.ledger>live.latestLedger||tx.ledger<previousLedger||
       tx.ledger<candidate.verifiedAtLedger)
      fail(step.id+" ledger outside retention, deployment or ordered lifecycle");
    if(!canonicalB64(tx.resultXdr)||!canonicalB64(tx.resultMetaXdr))
      fail(step.id+" missing transaction result/metadata XDR");
    const ledger=await rpc("getLedgers",{startLedger:tx.ledger,pagination:{limit:1}});
    if(!Array.isArray(ledger?.ledgers)||ledger.ledgers.length!==1||
       ledger.ledgers[0].sequence!==tx.ledger||
       !HASH.test(ledger.ledgers[0].hash||""))
      fail(step.id+" missing ledger hash anchor");
    const proof=await inspectEnvelope({
      envelopeXdr:tx.envelopeXdr,transactionHash:step.transactionHash,
      expectedSigner:step.expectedSigner,contractId:plan.contracts[step.role],
      method:step.method
    });
    if(proof?.envelopeHashVerified!==true||
       proof?.sourceWalletSignatureVerified!==true||
       proof?.invocationTargetVerified!==true||
       proof?.financialStateVerified!==false)
      fail(step.id+" incomplete or falsely elevated XDR verification");
    previousLedger=tx.ledger;
    collected.push(Object.freeze({
      id:step.id,method:step.method,role:step.role,
      hash:step.transactionHash,ledger:tx.ledger,
      ledgerHash:ledger.ledgers[0].hash.toLowerCase(),
      expectedSigner:step.expectedSigner,
      envelopeSignatureVerified:true,contractCallTargetVerified:true,
      providerReportedSuccess:true,financialStateVerified:false,
      source:"STELLAR_TESTNET_RPC_PROVIDER_REPORTED",
    }));
  }
  return Object.freeze({
    state:"PARTIAL_RECEIPT_EVIDENCE_NOT_END_TO_END_VERIFIED",
    network:"STELLAR_TESTNET",
    observedSuccessCount:collected.length,
    receipts:collected,
    independentlyVerifiedContractCode:false,
    multisignerSorobanAuthVerified:false,
    canonicalAssetAndStateDeltasVerified:false,
    crossProductUnifiedMarginVerified:false,
    protocolRiskAndOracleApproved:false,
    fullLifecycleVerified:false,
    executionPermitted:false,
    reason:"Cryptographically signed transaction envelopes and RPC claims do not prove Hoxo state/solvency, authorized Soroban sub-signers, approved contract bytecode, or unified margin.",
  });
}
/** Pinned read-only canonical Testnet RPC client: never accepts broadcast methods. */
export function makeM21Rpc({fetchImpl=fetch,timeoutMs=12000}={}){
  if(typeof fetchImpl!=="function"||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
    fail("Invalid read-only RPC transport");
  let id=0;
  const methods=new Set(["getNetwork","getHealth","getLatestLedger","getTransaction","getLedgers"]);
  return async (method,params={})=>{
    if(!methods.has(method))fail("Unapproved read-only RPC method "+method);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const requestId=++id;
      const response=await fetchImpl(TESTNET_CONFIG.rpc,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({jsonrpc:"2.0",id:requestId,method,params}),
        signal:controller.signal,cache:"no-store",
      });
      if(!response?.ok)fail("RPC HTTP "+String(response?.status));
      const body=await response.json();
      if(body?.jsonrpc!=="2.0"||body.id!==requestId||body.error||
         !body.result||typeof body.result!=="object"||Array.isArray(body.result))
        fail("RPC JSON-RPC identity or method error");
      return body.result;
    }finally{clearTimeout(timer);}
  };
}
