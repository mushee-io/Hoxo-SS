/**
 * Explicit operator-only VALueless Stellar Testnet deployment capability.
 * Actual spending uses an EXTERNALLY configured CLI identity/secure wallet;
 * never a secret, environment private key, automated CI identity or mainnet.
 * One role per invocation. No registry writes; independent verification needed.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {M23_PACKAGES} from "../beta/deployment-plan.mjs";
import {probeInfrastructure} from "../infra/network.mjs";
import {TESTNET_CONFIG} from "../config/testnet.mjs";

export const DEPLOY_ACK="I_UNDERSTAND_HOXO_TESTNET_UNAUDITED_NO_FINANCIAL_BETA";
export const AUXILIARY_TESTNET_PACKAGES=Object.freeze([
  Object.freeze({role:"portfolio-accounting",package:"hoxo-portfolio-accounting",
    wasm:"hoxo_portfolio_accounting.wasm",kind:"READ_ONLY_CROSS_PRODUCT_RISK_OBSERVER"}),
  Object.freeze({role:"custody-router",package:"hoxo-custody-router",
    wasm:"hoxo_custody_router.wasm",kind:"ISOLATED_ONLY_NO_SHARED_LEVERAGE"}),
]);
export const ALL_TESTNET_OPERATOR_PACKAGES=Object.freeze([...M23_PACKAGES,...AUXILIARY_TESTNET_PACKAGES]);
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(s){
  if(typeof s!=="string"||!/^C[A-Z2-7]{55}$/.test(s))return null;
  let acc=0,bits=0;
  const out=[];
  for(const c of s){
    acc=(acc<<5)|ALPHABET.indexOf(c);bits+=5;
    if(bits>=8){bits-=8;out.push((acc>>>bits)&255);acc&=(1<<bits)-1;}
  }
  if(bits&&acc!==0)return null;
  return out;
}
function crc16(bytes){
  let crc=0;
  for(const b of bytes){
    crc^=b<<8;
    for(let i=0;i<8;i++)
      crc=(crc&32768)?(((crc<<1)^0x1021)&65535):((crc<<1)&65535);
  }
  return crc;
}
export function isStellarCAddress(s){
  const b=decodeBase32(s);
  if(!b||b.length!==35||b[0]!==16)return false;
  const checksum=crc16(b.slice(0,33));
  return b[33]===(checksum&255)&&b[34]===(checksum>>8);
}
function requiredG(v,label){
  if(!isStellarGAddress(v))throw Error("Invalid Stellar public G address: "+label);
  return v;
}
function requiredC(v,label){
  if(!isStellarCAddress(v))throw Error("Invalid checksum-valid Stellar contract address: "+label);
  return v;
}
function requireDistinctContracts(pairs,label){
  const seen=new Set();
  for(const [name,address] of pairs){
    if(seen.has(address))throw Error(label+": duplicate contract address "+name);
    seen.add(address);
  }
}
export function validateTestnetOperatorConfig(config){
  if(!config||typeof config!=="object"||Array.isArray(config))
    throw Error("Reviewed external deployment configuration required");
  if(config.network!=="testnet"||config.networkPassphrase!==TESTNET_CONFIG.passphrase)
    throw Error("Hoxo deployment STRICTLY requires canonical STELLAR TESTNET");
  if(typeof config.sourceAlias!=="string"||
     !/^[a-zA-Z][a-zA-Z0-9_-]{1,50}$/.test(config.sourceAlias)||
     config.sourceAlias.startsWith("S"))
    throw Error("Only a short externally managed Stellar CLI identity ALIAS is supported, never a seed");
  return Object.freeze({
    sourceAlias:config.sourceAlias,
    adminPublicKey:requiredG(config.adminPublicKey,"adminPublicKey"),
    network:"testnet",
  });
}
export function prepareTestnetDeployment(config,role){
  const validated=validateTestnetOperatorConfig(config);
  const item=ALL_TESTNET_OPERATOR_PACKAGES.find(x=>x.role===role);
  if(!item)throw Error("Unrecognised Hoxo Testnet contract role");
  const owner=validated.adminPublicKey;
  const args=["contract","deploy","--wasm",
    "target/wasm32v1-none/release/"+item.wasm,
    "--source-account",config.sourceAlias,"--network","testnet"];
  {
    args.push("--");
    if(role==="portfolio-accounting"||role==="custody-router"){
      const vault=requiredC(config.riskVaultContract,"riskVaultContract");
      const lending=requiredC(config.moneyMarketContract,"moneyMarketContract");
      const perp=requiredC(config.perpClearinghouseContract,"perpClearinghouseContract");
      const asset=requiredC(config.valuelessTokenContract,"valuelessTokenContract");
      const deps=[["vault",vault],["lending",lending],["perp",perp],["asset",asset]];
      if(role==="custody-router"){
        deps.push(["spot",requiredC(config.spotSettlementContract,"spotSettlementContract")]);
      }
      requireDistinctContracts(deps,role);
      args.push("--admin",owner,"--vault",vault);
      if(role==="custody-router")args.push("--spot",requiredC(config.spotSettlementContract,"spotSettlementContract"));
      args.push("--lending",lending,"--perp",perp,"--asset",asset);
    }else if(role==="risk-engine"){
      const vault=requiredC(config.riskVaultContract,"riskVaultContract");
      const token=requiredC(config.valuelessTokenContract,"valuelessTokenContract");
      const oracle=requiredC(config.riskOracleContract,"riskOracleContract");
      requireDistinctContracts([["vault",vault],["oracle",oracle],["asset",token]],
        "Canonical risk");
      if(!Number.isSafeInteger(config.marketId)||config.marketId<1||config.marketId>4294967295)
        throw Error("Invalid canonical marketId");
      if(!Number.isSafeInteger(config.maxOwnerReservedE7)||
         config.maxOwnerReservedE7<1||config.maxOwnerReservedE7>100000*10000000)
        throw Error("Spot-only reservation cap must be a bounded integer in 7 decimals");
      args.push("--admin",owner,"--vault",vault,"--asset",token,
        "--oracle",oracle,"--market-id",String(config.marketId),
        "--max-owner-reserved-e7",String(config.maxOwnerReservedE7));
    }else if(role==="oracle-adapter"){
      const a=requiredG(config.publisherA,"publisherA");
      const b=requiredG(config.publisherB,"publisherB");
      if(owner===a||owner===b||a===b)throw Error("Oracle requires distinct admin and two independent publishers");
      if(!Number.isSafeInteger(config.marketId)||config.marketId<1||config.marketId>4294967295)
        throw Error("Invalid canonical marketId");
      args.push("--admin",owner,"--market-id",String(config.marketId),
        "--publisher-a",a,"--publisher-b",b);
    }else{
      args.push("--owner",owner);
      if(["money-market","unified-margin","perp-clearinghouse"].includes(role)){
        const token=requiredC(config.valuelessTokenContract,"valuelessTokenContract");
        args.push(role==="perp-clearinghouse"?"--token-addr":"--token-address",token);
      }
      if(role==="perp-clearinghouse"){
        if(!Number.isSafeInteger(config.marketId)||config.marketId<1||config.marketId>4294967295)
          throw Error("Invalid perp marketId");
        args.push("--market-id",String(config.marketId));
      }
    }
  }
  return Object.freeze({
    role,network:"testnet",stellarBinary:"stellar",
    args,sourceAlias:config.sourceAlias,
    wasm:item.wasm,
    transactionSubmitted:false,receiptVerified:false,contractId:null,
    financialBetaApproved:false,
    codeAudited:false,
    note:"CLI execution is operator-only and does not prove on-chain code, permissions or economic safety. Never enable deposits/trading.",
  });
}
export async function operatorDeployTestnet({
  config,role,acknowledgement,interactive=false,isCI=false,
  executor,probe=probeInfrastructure,
}={}){
  const prepared=prepareTestnetDeployment(config,role);
  if(acknowledgement!==DEPLOY_ACK||!interactive||isCI)
    throw Error("Operator-only Testnet contract deployment denied: local interactive acknowledgement required, CI prohibited");
  if(typeof executor!=="function"||typeof probe!=="function")
    throw Error("Operator CLI executor and read-only network preflight required");
  const health=await probe({config:TESTNET_CONFIG,timeoutMs:12000});
  if(health?.state!=="verified"||health.horizon?.state!=="verified"||
     health.rpc?.state!=="verified")
    throw Error("Stellar Testnet Horizon/RPC independent preflight failed, deployment not submitted");
  const status=await executor("stellar",prepared.args);
  if(status!==0)throw Error("Stellar CLI deployment failed, confirm no transaction occurred before retry");
  return Object.freeze({
    ...prepared,transactionSubmitted:"CLI_REPORTED_SUCCESS_NOT_INDEPENDENTLY_VERIFIED",
    receiptVerified:false,contractId:null,
    next:"Independently verify contract C-address, ledger/hash, admins, code hash and paused state; do not change registry until verified.",
  });
}

/**
 * Mandatory immutable post-deployment step for the canonical spot-risk
 * controller. This invokes ONLY bind_products, never unpauses the market
 * or enables M11 borrow/M12 perps. Never returns a fabricated receipt.
 */
export function prepareTestnetRiskBinding(config){
  const validated=validateTestnetOperatorConfig(config);
  const risk=requiredC(config.riskEngineContract,"riskEngineContract");
  const portfolio=requiredC(config.portfolioAccountingContract,"portfolioAccountingContract");
  const lending=requiredC(config.moneyMarketContract,"moneyMarketContract");
  const perp=requiredC(config.perpClearinghouseContract,"perpClearinghouseContract");
  requireDistinctContracts([["risk",risk],["portfolio",portfolio],["lending",lending],["perp",perp]],
    "Risk binding");
  if(config.riskVaultContract&&config.valuelessTokenContract){
    const vault=requiredC(config.riskVaultContract,"riskVaultContract");
    const asset=requiredC(config.valuelessTokenContract,"valuelessTokenContract");
    requireDistinctContracts([["risk",risk],["portfolio",portfolio],["lending",lending],
      ["perp",perp],["vault",vault],["asset",asset]],"Risk binding");
  }
  const args=["contract","invoke","--id",risk,"--source-account",validated.sourceAlias,
    "--network","testnet","--","bind_products","--portfolio",portfolio,
    "--lending",lending,"--perp",perp];
  return Object.freeze({
    action:"BIND_READ_ONLY_PORTFOLIO_AND_EXISTING_PRODUCT_DEBT_SOURCES",
    network:"testnet",sourceAlias:validated.sourceAlias,
    args,operatorMustAuthorizeAdmin:true,
    transactionSubmitted:false,receiptVerified:false,financialBetaApproved:false,
    leverageApproved:false,mainnetApproved:false,
    note:"Operator must verify risk is paused and admin signer authorises exact one-time binding. CLI success is not an independent ledger receipt.",
  });
}
export async function operatorBindTestnetRisk({
  config,acknowledgement,interactive=false,isCI=false,
  executor,probe=probeInfrastructure,
}={}){
  const prepared=prepareTestnetRiskBinding(config);
  if(acknowledgement!==DEPLOY_ACK||!interactive||isCI)
    throw Error("Operator-only binding denied: interactive acknowledgement required, CI prohibited");
  if(typeof executor!=="function"||typeof probe!=="function")
    throw Error("Operator CLI executor and read-only network preflight required");
  const health=await probe({config:TESTNET_CONFIG,timeoutMs:12000});
  if(health?.state!=="verified"||health.horizon?.state!=="verified"||
     health.rpc?.state!=="verified")
    throw Error("Stellar Testnet Horizon/RPC independent preflight failed, no binding submitted");
  const exitCode=await executor("stellar",prepared.args);
  if(exitCode!==0)throw Error("Stellar CLI bind_products failed; check chain state before retry");
  return Object.freeze({
    ...prepared,transactionSubmitted:"CLI_REPORTED_SUCCESS_NOT_INDEPENDENTLY_VERIFIED",
    receiptVerified:false,
    next:"Independently verify actual Testnet invoke receipt, risk paused state, all contract IDs and deployed WASM hashes; do not enable trading.",
  });
}
