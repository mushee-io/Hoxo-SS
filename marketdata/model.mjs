/**
 * Canonical market-data policy for Hoxo SS Stellar TESTNET.
 * Market candidates are not active listings. No source metadata grants trade permission.
 */
import {TESTNET_PASSPHRASE} from "../config/testnet.mjs";
import {isStellarGAddress} from "../app/wallet-core.mjs";

export const INSTRUMENTS=Object.freeze(["xlm-usdc-spot","btc-usdc-spot","xlm-usdc-perp","btc-usdc-perp","eth-usdc-perp"]);
export const PERIODS=Object.freeze({
 "1m":{resolution:60000,period:60000,window:120*60000},
 "30m":{resolution:900000,period:1800000,window:24*3600000},
 "1h":{resolution:3600000,period:3600000,window:48*3600000},
 "4h":{resolution:3600000,period:4*3600000,window:7*24*3600000},
 "1d":{resolution:86400000,period:86400000,window:30*86400000}
});
export const SCALE=10_000_000n;
export function parsePositive(value){
  if(typeof value!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value))throw Error("Invalid nonnegative fixed-point decimal");
  const [whole,frac=""]=value.split(".");
  const n=BigInt(whole)*SCALE+BigInt(frac.padEnd(7,"0"));
  if(n<=0n||n>=2n**127n)throw Error("Invalid positive fixed-point amount");
  return n;
}
export function toFixed(value){
  if(typeof value!=="bigint"||value<0n)throw Error("Invalid nonnegative fixed-point value");
  const rem=(value%SCALE).toString().padStart(7,"0").replace(/0+$/,"");
  return (value/SCALE).toString()+(rem?"."+rem:"");
}
export function validateAsset(a){
  if(!a||typeof a!=="object")throw Error("Missing Stellar asset");
  if(a.type==="native")return {asset_type:"native"};
  if(!["credit_alphanum4","credit_alphanum12"].includes(a.type)||
     !/^[A-Z0-9]{1,12}$/.test(a.code??"")||
     (a.type==="credit_alphanum4"&&a.code.length>4)||
     (a.type==="credit_alphanum12"&&a.code.length<=4)||
     !isStellarGAddress(a.issuer))throw Error("Invalid issued asset type, code or Testnet issuer account");
  return {asset_type:a.type,asset_code:a.code,asset_issuer:a.issuer};
}
function sameAsset(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export function validateMarketRegistry(registry){
  if(!registry||registry.schemaVersion!==1||registry.network!=="testnet"||registry.passphrase!==TESTNET_PASSPHRASE)throw Error("Market registry is not Stellar Testnet");
  if(!Array.isArray(registry.markets)||registry.markets.length!==INSTRUMENTS.length||
     new Set(registry.markets.map(m=>m.id)).size!==INSTRUMENTS.length)throw Error("Missing or duplicated reference instruments");
  const result={configured:0,unconfigured:0,perpConfigured:0};
  for(const market of registry.markets){
    if(!INSTRUMENTS.includes(market.id)||!["spot","perp"].includes(market.kind)||
       !market.id.endsWith(market.kind)||!["unconfigured","candidate"].includes(market.status))throw Error("Invalid reference market");
    if(market.status==="unconfigured"){
      if(market.quote!==null)throw Error("Unconfigured markets cannot claim a quote asset");
      if(market.base!==null)validateAsset(market.base);
      result.unconfigured++;
    }else{
      if(market.kind!=="spot")throw Error("Perp market oracle setup is independent of Horizon spot pairs");
      const base=validateAsset(market.base),quote=validateAsset(market.quote);
      if(sameAsset(base,quote))throw Error("A market cannot trade identical assets");
      result.configured++;
    }
  }
  if(!registry.oracle||registry.oracle.minIndependentSources!==2||
     registry.oracle.maxAgeMs!==120000||registry.oracle.maxSourceDeviationBps!==150||
     registry.oracle.maxMarkDeviationBps!==250||
     registry.oracle.positionPricingEnabled!==false||
     registry.oracle.halt!==true||!Array.isArray(registry.oracle.sources)||registry.oracle.sources.length!==0){
    throw Error("M5 oracle safety lock must remain halted with no approved sources");
  }
  return {...result,markets:registry.markets,oracleStatus:"HALTED: no verified on-chain oracle"};
}
export function configuredPair(registry,id){
  validateMarketRegistry(registry);
  const market=registry.markets.find(m=>m.id===id);
  if(!market||market.kind!=="spot"||market.status!=="candidate")return null;
  return {id,base:validateAsset(market.base),counter:validateAsset(market.quote)};
}
export function queryPair(pair){
  if(!pair||!pair.base||!pair.counter)throw Error("Pair not configured");
  const p=new URLSearchParams();
  for(const [prefix,asset] of [["base",pair.base],["counter",pair.counter]]){
    p.set(prefix+"_asset_type",asset.asset_type);
    if(asset.asset_type!=="native"){
      p.set(prefix+"_asset_code",asset.asset_code);
      p.set(prefix+"_asset_issuer",asset.asset_issuer);
    }
  }
  return p;
}
