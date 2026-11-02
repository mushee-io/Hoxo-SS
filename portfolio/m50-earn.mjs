/**
 * M50 Earn: conservative Testnet money-market readiness and unsigned amount
 * review. Never projects APY, interest, shares, borrowing power or Hoxo TVL
 * from Horizon wallet holdings. Does NOT call a protocol contract.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
const DEC=/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const TESTNET="Test SDF Network ; September 2015";
const MAX_E7=1_000_000_000_000_000_000n;
function fail(s){throw Error("M50 Earn: "+s);}
function toE7(value,name){
  if(typeof value!=="string"||!DEC.test(value))fail("invalid "+name);
  const [a,b=""]=value.split(".");
  const result=BigInt(a)*10000000n+BigInt(b.padEnd(7,"0")||"0");
  if(result<0n||result>MAX_E7)fail("out-of-range "+name);
  return result;
}
export function getM50MoneyMarketRegistryStatus(registry){
  if(!registry||registry.network!=="testnet"||registry.passphrase!==TESTNET||
    !Array.isArray(registry.contracts))fail("invalid Testnet deployment registry");
  const rows=registry.contracts.filter(r=>r?.role==="money-market");
  if(rows.length!==1)fail("missing or duplicate money-market contract entry");
  const pool=rows[0];
  const candidate=typeof pool.contractId==="string"&&/^C[A-Z2-7]{55}$/.test(pool.contractId)?
    pool.contractId:null;
  return Object.freeze({
    network:"Stellar Testnet",
    implementationPresent:true,
    registryStatus:typeof pool.status==="string"?pool.status:"unknown",
    candidateContract: candidate,
    independentOnChainVerification:false,
    depositsEnabled:false,withdrawalsEnabled:false,
    borrowEnabled:false,repayEnabled:false,
    interestVerified:false,liveApr:null,liveApy:null,
    reason:candidate?"Contract listed, but no independent code/pool verification in this view":
      "No verified deployed Hoxo money-market pool",
    capitalTransferPermitted:false
  });
}
export function previewM50EarnIntent({
  owner,asset="USDC",issuer=null,
  walletBalance,amount,network="Stellar Testnet"
}={}){
  if(!isStellarGAddress(owner)||network!=="Stellar Testnet")fail("verified Testnet wallet required");
  if(!["USDC","XLM"].includes(asset))fail("unsupported reference asset");
  if(asset==="XLM"&&issuer!==null)fail("native XLM must not have issuer");
  if(asset==="USDC"&&!isStellarGAddress(issuer))fail("USDC issuer must be verified");
  const held=toE7(walletBalance,"balance");
  const selected=toE7(amount,"amount");
  if(selected===0n)fail("amount must be greater than zero");
  if(selected>held)fail("proposal exceeds displayed wallet balance");
  // Wallet balances are not vault collateral or necessarily spendable.
  return Object.freeze({
    owner,asset,issuer,amountE7:selected.toString(),walletHeldE7:held.toString(),
    eligibleToSupply:false,independentlyQuotedInterest:false,
    projectedApy:null,sharesMinted:null,borrowCapacityE7:null,
    signingEnabled:false,executionPermitted:false,
    status:"UNSIGNED_PREVIEW_ONLY",
    note:"Wallet balance check only; XLM reserves and pool availability not established"
  });
}
