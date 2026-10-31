/**
 * Canonical HOXO SS Stellar Testnet configuration.
 * User-configured HTTPS RPC/Horizon origins must still pass exact Testnet handshake.
 * Browser app uses public defaults; CLI may override via environment variables.
 */
export const TESTNET_PASSPHRASE="Test SDF Network ; September 2015";
export const DEFAULT_ENDPOINTS=Object.freeze({
  horizon:"https://horizon-testnet.stellar.org",
  rpc:"https://soroban-testnet.stellar.org",
  friendbot:"https://friendbot.stellar.org",
  explorer:"https://stellar.expert/explorer/testnet"
});
export const MAX_LEDGER_AGE_MS=120_000;
export const MAX_LEDGER_DELTA=24;

export function normaliseEndpoint(candidate,{service}={}){
  if(typeof candidate!=="string"||candidate.trim()==="")throw new Error((service||"Endpoint")+" URL required");
  let url;
  try{url=new URL(candidate);}catch{throw new Error((service||"Endpoint")+" URL is invalid");}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
     url.hostname.endsWith(".local")||url.hostname==="localhost"||url.hostname==="127.0.0.1"){
    throw new Error((service||"Endpoint")+" requires a public HTTPS URL without credentials, parameters or fragment");
  }
  if(/(?:^|[.-])(mainnet|futurenet|pubnet)(?:[.-]|$)/i.test(url.hostname)){
    throw new Error((service||"Endpoint")+" may not point to a public/futurenet host");
  }
  return url.toString().replace(/\/$/,"");
}
export function makeTestnetConfig({horizon=DEFAULT_ENDPOINTS.horizon,rpc=DEFAULT_ENDPOINTS.rpc,friendbot=DEFAULT_ENDPOINTS.friendbot}={}){
  return Object.freeze({
    network:"testnet",
    passphrase:TESTNET_PASSPHRASE,
    horizon:normaliseEndpoint(horizon,{service:"Horizon"}),
    rpc:normaliseEndpoint(rpc,{service:"Stellar RPC"}),
    friendbot:normaliseEndpoint(friendbot,{service:"Friendbot"}),
    explorer:DEFAULT_ENDPOINTS.explorer
  });
}
export const TESTNET_CONFIG=makeTestnetConfig();
