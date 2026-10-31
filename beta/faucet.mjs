/**
 * M23 operator-only Stellar Friendbot Testnet faucet, NEVER a public faucet API.
 * No private keys or transfers of real assets. Disabled without explicit CLI
 * acknowledgement and a verified canonical RPC+Horizon network handshake.
 */
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {probeInfrastructure} from "../infra/network.mjs";
import {TESTNET_CONFIG,TESTNET_PASSPHRASE} from "../config/testnet.mjs";

export const M23_FAUCET_ACK="REQUEST_VALUELESS_STELLAR_TESTNET_XLM";
export const M23_FRIENDBOT_ORIGIN="https://friendbot.stellar.org";

export function m23FundingPreview(account){
  if(!isStellarGAddress(account))throw Error("M23 faucet requires a checksum-valid Stellar G account, no secret or contract ID");
  return Object.freeze({
    account,network:"Stellar Testnet",passphrase:TESTNET_PASSPHRASE,
    fundingRequested:false,accountFunded:false,
    exactAcknowledgementRequired:M23_FAUCET_ACK,
    source:"STELLAR_OFFICIAL_TESTNET_FRIENDBOT",
    note:"Optional operator-only XLM gas faucet; not Hoxo collateral, a liquidity pool, or user rewards.",
  });
}
export async function requestM23TestnetXlm({
  account,acknowledgement="",fetchImpl=fetch,
  probe=probeInfrastructure,timeoutMs=12000,
}={}){
  const preview=m23FundingPreview(account);
  if(acknowledgement!==M23_FAUCET_ACK)
    throw Error("M23 faucet disabled: explicit Testnet-only operator acknowledgement required");
  if(typeof fetchImpl!=="function"||typeof probe!=="function"||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
    throw Error("Invalid M23 faucet transport");
  const health=await probe({config:TESTNET_CONFIG,fetchImpl,timeoutMs});
  if(health?.state!=="verified"||
     health.horizon?.state!=="verified"||health.rpc?.state!=="verified")
    throw Error("M23 faucet refused: independent Horizon and RPC Testnet health handshake required");
  const url=new URL("/",M23_FRIENDBOT_ORIGIN);
  url.searchParams.set("addr",account);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url.toString(),{
      method:"GET",headers:{"Accept":"application/json"},
      signal:controller.signal,cache:"no-store",redirect:"error",
    });
    if(response?.status!==200||!response.ok)
      throw Error("M23 Friendbot did not accept funding request; may already be funded or rate limited");
    // Friendbot response bodies vary; do not assume a 200 proves funded state.
    return Object.freeze({
      ...preview, fundingRequested:true,
      providerResponse:"HTTP_200_FRIENDBOT_ACCEPTED",
      accountFunded:false,
      independentFundingVerificationRequired:true,
      verificationInstruction:"Query canonical Stellar Testnet Horizon account and final transaction ledger independently.",
      financialTradingEnabled:false,
    });
  }finally{clearTimeout(timer);}
}
