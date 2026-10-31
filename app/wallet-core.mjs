/**
 * Hoxo-SS M3 — Freighter wallet read-only controller.
 * Testnet only. NO transaction signing, secret keys, contract calls, trade execution.
 * Do not interpret Horizon holdings as unified-margin collateral.
 */
import {TESTNET,validateHorizonRoot} from "../assets/testnet-status.mjs";
export const HORIZON=TESTNET.horizon;
export const FRIENDBOT="https://friendbot.stellar.org";
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(text) {
  let buffer=0,bits=0;
  const bytes=[];
  for (const char of text) {
    const value=ALPHABET.indexOf(char);
    if(value<0)return null;
    buffer=(buffer<<5)|value;
    bits+=5;
    if(bits>=8){bits-=8;bytes.push((buffer>>>bits)&255);buffer&=(1<<bits)-1;}
  }
  if(bits && buffer!==0)return null;
  return bytes;
}
function crc16(data){
  let crc=0;
  for(const byte of data){
    crc^=byte<<8;
    for(let i=0;i<8;i++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  return crc;
}
/** Validate Stellar ed25519 account StrKey with version byte and CRC16-XModem checksum. */
export function isStellarGAddress(address){
  if(typeof address!=="string"||!/^G[A-Z2-7]{55}$/.test(address))return false;
  const decoded=decodeBase32(address);
  if(!decoded||decoded.length!==35||decoded[0]!==48)return false;
  const sum=crc16(decoded.slice(0,33));
  return decoded[33]===(sum&255)&&decoded[34]===(sum>>8);
}
function walletError(result,label){
  if(result?.error)throw new Error(label+": "+String(result.error?.message||"Wallet API error"));
  if(!result||typeof result!=="object")throw new Error(label+": invalid wallet response");
  return result;
}
export function verifyWalletNetwork(network){
  const result=walletError(network,"Freighter network");
  if(result.networkPassphrase!==TESTNET.passphrase||result.network!=="TESTNET"){
    throw new Error("Wrong network. Switch Freighter to Stellar TESTNET (not mainnet/futurenet).");
  }
  return true;
}
export function normalizeBalances(balances){
  if(!Array.isArray(balances))throw new Error("Horizon returned no balance array");
  return balances.map((entry)=>{
    if(!entry||typeof entry!=="object"||typeof entry.balance!=="string"||
      !/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(entry.balance))throw new Error("Malformed Horizon balance");
    if(entry.asset_type==="native")return {id:"XLM",asset:"XLM",balance:entry.balance,issuer:"Native Stellar asset"};
    if(typeof entry.asset_code!=="string"||!/^[a-zA-Z0-9]{1,12}$/.test(entry.asset_code)||
      !isStellarGAddress(entry.asset_issuer))throw new Error("Malformed Horizon trustline");
    return {
      id:entry.asset_code+":"+entry.asset_issuer,
      asset:entry.asset_code,balance:entry.balance,issuer:entry.asset_issuer
    };
  }).sort((a,b)=>a.asset==="XLM"?-1:b.asset==="XLM"?1:a.id.localeCompare(b.id));
}
async function jsonRequest(url,fetchImpl,timeoutMs=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetchImpl(url,{method:"GET",headers:{Accept:"application/json"},cache:"no-store",signal:controller.signal});
    if(res.status===404)return {notFound:true};
    if(!res.ok)throw new Error("Horizon HTTP "+res.status);
    return {data:await res.json()};
  }finally{clearTimeout(timer);}
}
export async function loadTestnetAccount(address,{fetchImpl=fetch,nowMs=Date.now()}={}){
  if(!isStellarGAddress(address))throw new Error("Invalid Stellar account address");
  const root=await jsonRequest(HORIZON+"/",fetchImpl);
  if(!root.data)throw new Error("Horizon network proof unavailable");
  const check=validateHorizonRoot(root.data,nowMs);
  if(check.state!=="verified")throw new Error("Stellar Testnet cannot be verified: "+check.message);
  const result=await jsonRequest(HORIZON+"/accounts/"+encodeURIComponent(address),fetchImpl);
  if(result.notFound)return {funded:false,balances:[],ledger:check.ledger};
  if(result.data?.account_id!==address)throw new Error("Horizon account identity mismatch");
  return {funded:true,balances:normalizeBalances(result.data.balances),ledger:check.ledger};
}

export function createWalletSession({api,fetchImpl=fetch,onChange=()=>{},now=()=>Date.now()}={}){
  let seq=0;
  let state={status:"disconnected",address:null,balances:[],message:"Connect Freighter on Stellar Testnet.",ledger:null};
  const snapshot=()=>({...state,balances:state.balances.map(x=>({...x}))});
  const emit=(update)=>{state={...state,...update};onChange(snapshot());return snapshot();};
  const reset=(status="disconnected",message="Wallet disconnected from this page.")=>
    emit({status,address:null,balances:[],ledger:null,message});
  const stale=(n)=>n!==seq;
  async function verifyFreighter(){
    if(!api||typeof api.isConnected!=="function"||typeof api.requestAccess!=="function"||
      typeof api.getNetwork!=="function"||typeof api.getAddress!=="function") {
      throw new Error("Freighter extension API unavailable. Install Freighter in a compatible desktop browser.");
    }
    const connected=walletError(await api.isConnected(),"Freighter detection");
    if(!connected.isConnected)throw new Error("Freighter extension not detected.");
  }
  async function currentIdentity(expected){
    await verifyFreighter();
    verifyWalletNetwork(await api.getNetwork());
    const current=walletError(await api.getAddress(),"Freighter account").address;
    if(!isStellarGAddress(current))throw new Error("Invalid wallet account");
    if(expected&&current!==expected)throw new Error("Freighter account changed. Reconnect to confirm the new address.");
    return current;
  }
  const failure=(error)=> {
    const message=String(error?.message||error||"Wallet verification failed");
    const status=/Wrong network/i.test(message)?"wrong-network":"error";
    return reset(status,message);
  };
  async function connect(){
    const n=++seq;
    emit({status:"connecting",address:null,balances:[],ledger:null,message:"Waiting for Freighter approval..."});
    try{
      await verifyFreighter();
      const access=walletError(await api.requestAccess(),"Wallet access");
      if(!isStellarGAddress(access.address))throw new Error("Wallet returned invalid Stellar address");
      const address=await currentIdentity(access.address);
      if(stale(n))return snapshot();
      emit({status:"loading",address,balances:[],ledger:null,message:"Checking Stellar Testnet and wallet balances..."});
      return await read(n,address);
    }catch(error){if(!stale(n))failure(error);return snapshot();}
  }
  async function read(n,address){
    try{
      const result=await loadTestnetAccount(address,{fetchImpl,nowMs:now()});
      if(stale(n))return snapshot();
      return emit({status:result.funded?"connected":"unfunded",address,balances:result.balances,ledger:result.ledger,
        message:result.funded?"Wallet balances verified on Stellar Testnet. Not exchange collateral.":"Account not funded on Stellar Testnet."});
    }catch(error){if(!stale(n))failure(error);return snapshot();}
  }
  async function refresh(){
    if(!state.address)return snapshot();
    const n=++seq;
    const account=state.address;
    emit({status:"loading",balances:[],ledger:null,message:"Revalidating Freighter network, account and Horizon..."});
    try{
      await currentIdentity(account);
      if(stale(n))return snapshot();
      return await read(n,account);
    }catch(error){if(!stale(n))failure(error);return snapshot();}
  }
  function disconnect(){seq++;return reset();}
  /** Explicitly user-confirmed faucet only for an unfunded, verified Testnet account. */
  async function fund(){
    if(state.status!=="unfunded"||!state.address)throw new Error("Testnet faucet is only available for an unfunded, verified wallet.");
    const address=state.address;
    const n=++seq;
    emit({status:"funding",message:"Rechecking wallet identity before Friendbot request..."});
    try{
      await currentIdentity(address);
      // Recheck endpoint proof and funding status prior to requesting a network write.
      const before=await loadTestnetAccount(address,{fetchImpl,nowMs:now()});
      if(stale(n))return snapshot();
      if(before.funded){
        return emit({status:"connected",balances:before.balances,ledger:before.ledger,message:"Account is already funded. Faucet request cancelled."});
      }
      const response=await fetchImpl(FRIENDBOT+"/?addr="+encodeURIComponent(address),{method:"GET",cache:"no-store"});
      if(!response.ok)throw new Error("Friendbot rejected the request (HTTP "+response.status+").");
      if(stale(n))return snapshot();
      // Receipt is not itself evidence of a funded account; re-fetch canonical Horizon state.
      emit({status:"loading",message:"Friendbot responded. Verifying account creation on Horizon..."});
      return await read(n,address);
    }catch(error){if(!stale(n))failure(error);return snapshot();}
  }
  return {snapshot,connect,refresh,disconnect,fund};
}
