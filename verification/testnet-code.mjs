/**
 * M26: independently compare locally reviewed WASM bytes with code installed
 * at concrete public Stellar TESTNET C-addresses. This is a READ-ONLY audit
 * aid, NOT an attestation that a deployment tx created that address, or an
 * authorisation to enable financial trading.
 *
 * Never reads signing secrets, never sends transactions, never updates the
 * operator registry, and never treats an RPC-reported SUCCESS as chain proof
 * of constructor args or admin authority.
 */
import {createHash} from "node:crypto";
import {readFile,lstat,realpath} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {isStellarContractId} from "../infra/registry.mjs";
import {TESTNET_PASSPHRASE,TESTNET_CONFIG} from "../config/testnet.mjs";
import {ALL_TESTNET_OPERATOR_PACKAGES} from "../deployment/testnet-operator.mjs";

const SHA=/^[0-9a-f]{64}$/i;
const WASM_HEADER=Buffer.from([0,97,115,109,1,0,0,0]);
const MAX_WASM_BYTES=10_000_000;
const ROLES=new Map(ALL_TESTNET_OPERATOR_PACKAGES.map(x=>[x.role,x]));
const err=msg=>{throw Error("M26 proof: "+msg);};
function strictObject(value,keys,label){
  if(!value||typeof value!=="object"||Array.isArray(value)||
     JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))
    err(label+" must contain exactly "+keys.join(", "));
}
function hex(value,label){
  if(typeof value!=="string"||!SHA.test(value))err("Invalid "+label+" hex hash");
  return value.toLowerCase();
}
function correctWasm(value,label){
  const data=Buffer.from(value||[]);
  if(data.length<=8||data.length>MAX_WASM_BYTES||
     !data.subarray(0,8).equals(WASM_HEADER))
    err("Malformed, missing or oversized WASM bytes for "+label);
  return data;
}
export function validateTestnetCodeManifest(manifest){
  strictObject(manifest,["schemaVersion","networkPassphrase","contracts"],"manifest");
  if(manifest.schemaVersion!==1||manifest.networkPassphrase!==TESTNET_PASSPHRASE)
    err("Only the canonical Stellar Testnet manifest is permitted");
  if(!Array.isArray(manifest.contracts)||manifest.contracts.length<1||
     manifest.contracts.length>ROLES.size)
    err("Supply between one and "+ROLES.size+" contract proofs");
  const roles=new Set(),contracts=new Set(),txs=new Set();
  const entries=manifest.contracts.map((entry,i)=>{
    strictObject(entry,["role","contractId","deploymentTxHash"],"contract "+i);
    if(!ROLES.has(entry.role)||roles.has(entry.role))
      err("Unknown or duplicate Hoxo role: "+entry.role);
    if(!isStellarContractId(entry.contractId)||contracts.has(entry.contractId))
      err("Invalid or repeated Stellar C-address for "+entry.role);
    const transactionHash=hex(entry.deploymentTxHash,"deploymentTxHash");
    if(txs.has(transactionHash))err("Duplicate deployment transaction hash");
    roles.add(entry.role);contracts.add(entry.contractId);txs.add(transactionHash);
    return Object.freeze({
      role:entry.role,contractId:entry.contractId,
      deploymentTxHash:transactionHash,
      wasm:ROLES.get(entry.role).wasm,
    });
  });
  return Object.freeze({
    networkPassphrase:manifest.networkPassphrase,
    contracts:Object.freeze(entries),
  });
}
export async function loadReviewedTestnetWasm({
  wasmDirectory,role,read=readFile,stat=lstat,real=realpath,
}){
  if(typeof wasmDirectory!=="string"||!wasmDirectory||wasmDirectory.includes("\0")||
     !ROLES.has(role))
    err("Explicit approved WASM root and known role required");
  const root=await real(resolve(wasmDirectory));
  const path=join(root,ROLES.get(role).wasm);
  if(!path.startsWith(root+sep))err("WASM escaped reviewed output directory");
  const details=await stat(path);
  if(!details.isFile()||details.isSymbolicLink()||details.size<9||
     details.size>MAX_WASM_BYTES)
    err("WASM is not a regular bounded file for "+role);
  const bytes=correctWasm(await read(path),role);
  if(bytes.length!==details.size)err("WASM changed during inspection for "+role);
  return bytes;
}
function responseNetwork(value){
  const passphrase=value?.passphrase;
  if(passphrase!==TESTNET_PASSPHRASE)
    err("Connected RPC returned wrong network passphrase");
}
function readLedger(value,nowMs){
  const sequence=Number(value?.sequence);
  const close=Number(value?.closeTime);
  if(!Number.isSafeInteger(sequence)||sequence<1||
     !Number.isSafeInteger(close)||close<1||
     !Number.isSafeInteger(nowMs)||nowMs<=0)
    err("Invalid latest-ledger metadata");
  const ageMs=nowMs-close*1000;
  if(ageMs<0||ageMs>120_000)
    err("Latest Stellar Testnet ledger is stale or from the future");
  return sequence;
}
export async function verifyTestnetCode({
  manifest,server,wasmDirectory,
  readWasm=role=>loadReviewedTestnetWasm({wasmDirectory,role}),
  nowMs=Date.now(),
}){
  const plan=validateTestnetCodeManifest(manifest);
  if(!server||
     typeof server.getNetwork!=="function"||
     typeof server.getHealth!=="function"||
     typeof server.getLatestLedger!=="function"||
     typeof server.getTransaction!=="function"||
     typeof server.getContractWasmByContractId!=="function"||
     typeof readWasm!=="function")
    err("Independent read-only Stellar RPC and reviewed WASM files required");
  const [network,health,head]=await Promise.all([
    server.getNetwork(),server.getHealth(),server.getLatestLedger(),
  ]);
  responseNetwork(network);
  if(health?.status!=="healthy")err("Stellar Testnet RPC not healthy");
  const currentLedger=readLedger(head,nowMs);
  const out=[];
  for(const item of plan.contracts){
    const local=correctWasm(await readWasm(item.role),item.role+" local");
    const localHash=createHash("sha256").update(local).digest("hex");
    // Client retrieves the deployed contract INSTANCE and corresponding
    // installed Wasm bytes, following the code-hash reference on-chain.
    const onchain=correctWasm(
      await server.getContractWasmByContractId(item.contractId),
      item.role+" on-chain"
    );
    const onchainHash=createHash("sha256").update(onchain).digest("hex");
    if(onchainHash!==localHash||onchain.length!==local.length)
      err("Deployed WASM differs from reviewed file for "+item.role);
    const tx=await server.getTransaction(item.deploymentTxHash);
    if(tx?.status!=="SUCCESS")err(item.role+" deployment transaction not successful");
    if(hex(tx.txHash,"RPC txHash")!==item.deploymentTxHash)
      err(item.role+" provider returned wrong transaction hash");
    if(!Number.isSafeInteger(tx.ledger)||tx.ledger<1||tx.ledger>currentLedger)
      err(item.role+" transaction ledger untrustworthy");
    out.push(Object.freeze({
      role:item.role,contractId:item.contractId,
      deploymentTxHash:item.deploymentTxHash,
      receiptLedger:tx.ledger,
      localWasmSha256:localHash,onChainWasmSha256:onchainHash,
      sourceAndOnchainCodeMatch:true,
      providerReportsTransactionSuccess:true,
      // This verifier does NOT prove that the supplied tx created the
      // supplied C-address. Linkage requires actual XDR metadata tracing.
      deploymentTransactionLinkedToContract:false,
      adminOrConstructorArgsVerified:false,
      contractPausedAndCorrectRiskBoundVerified:false,
      independentAuditorApproval:false,
      financialBetaAuthorized:false,
    }));
  }
  return Object.freeze({
    network:"STELLAR_TESTNET",
    latestLedger:currentLedger,
    verifiedWasmMatches:out.length,
    contracts:Object.freeze(out),
    source:"READ_ONLY_STELLAR_RPC_OBSERVATION",
    status:"SOURCE_CODE_MATCHED_AND_TX_REPORTED_SUCCESS_NOT_DEPLOYMENT_ATTESTATION",
    deploymentProven:false,
    realTradingVerified:false,
    permissionToOpenFinancialBeta:false,
    permissionToOpenMainnet:false,
    missing:[
      "Cryptographic proof supplied deployment transaction created exact C-address",
      "On-chain constructor arguments and admin/signing authorities",
      "Audited contract code and liquidations/economic model",
      "Operator-authorised real Testnet trade receipts and token balance deltas",
    ],
  });
}
export async function createLiveCodeVerificationServer({sdk}={}){
  if(!sdk?.rpc?.Server)err("Pinned @stellar/stellar-sdk RPC Server required");
  return new sdk.rpc.Server(TESTNET_CONFIG.rpc,{allowHttp:false});
}
