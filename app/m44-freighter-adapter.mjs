/**
 * M44 official Freighter browser-extension adapter (SEP-43).
 * No auto-connect, seed imports, signing on load, submit, RPC or broadcast.
 * Supply window.freighterApi from the pinned extension script or the official
 * @stellar/freighter-api module. All wallet calls happen on explicit M43
 * approve() actions; never pass submit:true.
 */
import {TESTNET_PASSPHRASE} from "./m43-freighter-auth-guard.mjs";

function fail(message){throw Error("M44 Freighter: "+message);}
function plainResult(value,label,fields){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail(label+" must return plain object");
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=="string"||!fields.includes(key))fail(label+" returned unexpected field");
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!("value" in descriptor))fail(label+" returned accessor");
  }
  if(value.error!=null)fail(label+" rejected: "+String(value.error?.message||"wallet error"));
  return value;
}
export function createM44FreighterBrowserAdapter(api){
  if(!api||["getAddress","getNetwork","signAuthEntry","signTransaction"].some(k=>typeof api[k]!=="function"))
    fail("official Freighter API not available");
  return Object.freeze({
    async getAddress(){
      const result=plainResult(await api.getAddress(),"getAddress",["address","error"]);
      if(typeof result.address!=="string"||!/^G[A-Z2-7]{55}$/.test(result.address))fail("invalid connected G-account");
      return {address:result.address};
    },
    async getNetwork(){
      const result=plainResult(await api.getNetwork(),"getNetwork",["network","networkPassphrase","networkUrl","sorobanRpcUrl","error"]);
      if(result.networkPassphrase!==TESTNET_PASSPHRASE)fail("Stellar Testnet must be selected");
      return {networkPassphrase:TESTNET_PASSPHRASE};
    },
    async signAuthEntry(xdr,options){
      if(options?.networkPassphrase!==TESTNET_PASSPHRASE||!options.address)
        fail("explicit Testnet and taker address required");
      const result=plainResult(await api.signAuthEntry(xdr,{
        address:options.address,networkPassphrase:TESTNET_PASSPHRASE
      }),"signAuthEntry",["signedAuthEntry","signerAddress","error"]);
      if(result.signerAddress!==options.address)fail("auth entry signer differs from requested address");
      return {signedAuthEntry:result.signedAuthEntry,signerAddress:result.signerAddress};
    },
    async signTransaction(xdr,options){
      if(options?.networkPassphrase!==TESTNET_PASSPHRASE||!options.address)
        fail("explicit Testnet and source address required");
      // Explicitly NEVER send from wallet. SEP-43 supports submit:true, which is
      // forbidden here even if the caller tries to smuggle it into options.
      const result=plainResult(await api.signTransaction(xdr,{
        address:options.address,networkPassphrase:TESTNET_PASSPHRASE,submit:false
      }),"signTransaction",["signedTxXdr","signerAddress","error"]);
      if(result.signerAddress!==options.address)fail("envelope signer differs from requested address");
      return {signedTxXdr:result.signedTxXdr,signerAddress:result.signerAddress};
    }
  });
}
export function getM44FreighterFromWindow(host){
  const api=host?.freighterApi;
  if(!api)fail("Freighter API missing; load official extension integration first");
  return createM44FreighterBrowserAdapter(api);
}
