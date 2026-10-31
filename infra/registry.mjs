/** Strict M4 registry validation; metadata alone never proves contract existence. */
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";

const KNOWN_ROLES=Object.freeze(["collateral-vault","oracle-adapter","risk-engine","spot-settlement","money-market","perp-clearinghouse","unified-margin"]);
const EXPECTED_MILESTONES=Object.freeze({
  "collateral-vault":"M6","oracle-adapter":"M5","risk-engine":"M7",
  "spot-settlement":"M9","money-market":"M10","perp-clearinghouse":"M12","unified-margin":"M15"
});
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode32(s){
  let bits=0,value=0,bytes=[];
  for(const ch of s){
    const n=ALPHABET.indexOf(ch);if(n<0)return null;
    value=(value<<5)|n;bits+=5;
    if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);value&=(1<<bits)-1;}
  }
  if(bits&&value!==0)return null;
  return bytes;
}
function crc16(input){
  let crc=0;
  for(const b of input){crc^=b<<8;for(let i=0;i<8;i++)crc=crc&32768?((crc<<1)^0x1021)&65535:(crc<<1)&65535;}
  return crc;
}
export function isStellarContractId(id){
  if(typeof id!=="string"||!/^C[A-Z2-7]{55}$/.test(id))return false;
  const decoded=decode32(id);
  if(!decoded||decoded.length!==35||decoded[0]!==16)return false;
  const checksum=crc16(decoded.slice(0,33));
  return decoded[33]===(checksum&255)&&decoded[34]===(checksum>>8);
}
const validHash=h=>typeof h==="string"&&/^[0-9a-fA-F]{64}$/.test(h);
export function validateRegistry(data){
  if(!data||typeof data!=="object"||Array.isArray(data)||data.schemaVersion!==1||
    data.network!=="testnet"||data.passphrase!==TESTNET_PASSPHRASE)throw Error("Registry must target canonical Stellar Testnet.");
  if(!Array.isArray(data.assets)||!Array.isArray(data.contracts))throw Error("Missing assets/contracts registry arrays.");
  if(data.contracts.length!==KNOWN_ROLES.length||
    new Set(data.contracts.map(x=>x.role)).size!==KNOWN_ROLES.length)throw Error("Registry roles missing or duplicated.");
  for(const contract of data.contracts){
    if(!KNOWN_ROLES.includes(contract.role)||contract.milestone!==EXPECTED_MILESTONES[contract.role]){
      throw Error("Unexpected contract role or milestone.");
    }
    if(contract.status==="planned"){
      if(contract.contractId!==null||contract.deploymentTxHash!==null||contract.verifiedAtLedger!==null){
        throw Error("Planned contracts cannot contain deployment assertions.");
      }
    }else if(contract.status==="candidate"){
      if(!isStellarContractId(contract.contractId)||!validHash(contract.deploymentTxHash)||
        !Number.isSafeInteger(contract.verifiedAtLedger)||contract.verifiedAtLedger<1){
        throw Error("Candidate contracts need valid IDs and deployment evidence metadata.");
      }
    }else throw Error("Contract status must be planned or candidate (never self-declared verified).");
  }
  if(data.assets.length<1||new Set(data.assets.map(a=>a.key)).size!==data.assets.length)throw Error("Invalid asset registry.");
  for(const asset of data.assets){
    if(asset.kind==="native"){
      if(asset.key!=="XLM"||asset.issuer!==null||asset.contractId!==null||asset.status!=="native-asset")
        throw Error("Native asset must be canonical XLM.");
    }else if(asset.kind==="issued"){
      if(!/^[A-Z0-9]{1,12}$/.test(asset.key)||!isStellarGAddress(asset.issuer)||
         asset.status!=="candidate"||
         (asset.contractId!==null&&!isStellarContractId(asset.contractId))){
        throw Error("Issued assets must be candidates with a valid issuer.");
      }
    }else throw Error("Unknown asset kind.");
  }
  if(!data.assets.some(asset=>asset.key==="XLM"&&asset.kind==="native"))throw Error("Native XLM must be registered.");
  if(!data.networkReset||!Object.hasOwn(data.networkReset,"lastVerifiedAt")||
     !Object.hasOwn(data.networkReset,"lastVerifiedLedger"))throw Error("Network reset tracking is required.");
  return {
    network:data.network,assetCount:data.assets.length,
    candidateAssets:data.assets.filter(x=>x.kind==="issued").length,
    contractCount:data.contracts.length,
    candidateContracts:data.contracts.filter(x=>x.status==="candidate").length,
    deployedVerified:0, // No registry-only claim is ever accepted as on-chain proof.
    statuses:data.contracts.map(x=>({role:x.role,status:x.status,contractId:x.contractId}))
  };
}
