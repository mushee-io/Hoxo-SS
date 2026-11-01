/**
 * M41: authenticated by LIVE READ-ONLY Stellar Testnet RPC/Horizon only.
 * No wallet secrets, transaction construction, signatures or broadcasts.
 * Never turns a ready asset checklist into trading authorization.
 */
import {Asset,Networks,rpc} from "@stellar/stellar-sdk";
import {isStellarGAddress} from "../app/wallet-core.mjs";
import {isStellarContractId} from "../infra/registry.mjs";
import {TESTNET_CONFIG,TESTNET_PASSPHRASE} from "../config/testnet.mjs";

export const M41_SPOT_CANDIDATE=Object.freeze({
  network:"testnet",
  networkPassphrase:TESTNET_PASSPHRASE,
  spotContractId:"CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF",
  spotOwner:"GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB",
  otherTrader:"GB6PLT5RXSSCCEI6AF4CIBBLC6DXIMDIFKHK5YY3EFZHLXK4TBK4RCZ2",
  spotWasmSha256:"916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3",
  spotDeployTx:"91280d18358b642ae31668ed114b879a52e175c842ee869f23d28666558e640a",
  base:"XLM",
  baseSac:"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  quote:"USDC",
  quoteIssuer:"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  quoteSac:"CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
});
const HEX=/^[a-f0-9]{64}$/;
function expect(value,label){if(!value)throw Error("M41 "+label);}
function requireRead(response,label){
  expect(response&&response.isReadCall===true,label+" must be an actual side-effect-free Stellar RPC read");
  return response.result;
}
function nat7(value,label){
  expect(typeof value==="string"&&/^(0|[1-9]\d*)\.\d{7}$/.test(value),label+" balance must be an exact seven-decimal string");
  const [whole,frac]=value.split(".");
  return BigInt(whole)*10_000_000n+BigInt(frac);
}
function plainInfo(account,owner,candidate){
  expect(account&&account.account_id===owner&&Array.isArray(account.balances),
    "Horizon account identity mismatch or invalid balance format");
  const native=account.balances.filter(x=>x.asset_type==="native");
  expect(native.length===1,"Horizon native XLM balance not uniquely identified");
  const quote=account.balances.filter(x=>x.asset_code===candidate.quote&&
    x.asset_issuer===candidate.quoteIssuer&&x.asset_type==="credit_alphanum4");
  expect(quote.length<=1,"duplicate matching USDC trustlines");
  const xlm=nat7(native[0].balance,"XLM");
  const usdc=quote.length?nat7(quote[0].balance,"USDC"):0n;
  const authorized=Boolean(quote.length&&quote[0].is_authorized===true);
  return Object.freeze({
    publicKey:owner,
    xlmE7:xlm.toString(),usdcE7:usdc.toString(),
    usdcTrustlinePresent:quote.length===1,
    usdcTrustlineAuthorized:authorized,
  });
}
function codeHashFromInstance(instance){
  if(!instance)
    throw Error("M41 deployed WASM contract instance unavailable from Stellar RPC");
  let wasm;
  const executable=typeof instance.executable==="function"
    ? instance.executable():instance.executable;
  if(executable&&typeof executable.wasmHash==="function"){
    try{wasm=executable.wasmHash();}catch{}
  }else if(executable&&typeof executable==="object"){
    wasm=executable.wasmHash??executable.wasm_hash??executable.hash;
  }
  if(typeof wasm==="string"){
    if(/^[a-f0-9]{64}$/i.test(wasm))return wasm.toLowerCase();
    if(/^[A-Za-z0-9+/]{43}=$/.test(wasm)){
      const decoded=Buffer.from(wasm,"base64");
      if(decoded.length===32&&decoded.toString("base64")===wasm)
        return decoded.toString("hex");
    }
  }
  if(wasm&&wasm.length===32)return Buffer.from(wasm).toString("hex");
  if(wasm&&wasm.type==="Buffer"&&Array.isArray(wasm.data)&&wasm.data.length===32)
    return Buffer.from(wasm.data).toString("hex");
  const shape=JSON.stringify({
    keys:Object.keys(instance||{}),executableType:typeof instance?.executable,
    executableKeys:executable&&typeof executable==="object"?Object.keys(executable):[],
    wasmType:typeof wasm,wasmLength:wasm?.length,
    wasmConstructor:wasm?.constructor?.name,
    wasmPreview:typeof wasm==="string"?wasm.slice(0,80):null,
  });
  throw Error("M41 deployed contract executable could not be verified from Stellar RPC: "+shape);
}
async function horizonAccount(fetchImpl,address){
  const result=await fetchImpl(TESTNET_CONFIG.horizon+"/accounts/"+encodeURIComponent(address),{
    method:"GET",headers:{accept:"application/json"},
  });
  expect(result?.ok===true,"Horizon Testnet account request failed for "+address);
  return result.json();
}
/**
 * Operator-friendly public preflight for the specific M9 spot candidate.
 * It also establishes precise remaining SIGNED action blockers.
 * Throws closed on network/code/admin divergence. Even a clean result is
 * NOT permission to unpause, use mainnet, trade, or report Testnet volume.
 */
export async function checkM41SpotAssetReadiness({
  server,
  fetchImpl=fetch,
  candidate=M41_SPOT_CANDIDATE
}={}){
  expect(server&&typeof server.getNetwork==="function"&&
    typeof server.getContractInstance==="function"&&
    typeof server.queryContract==="function",
    "genuine Stellar RPC read-only transport required");
  expect(typeof fetchImpl==="function","Horizon transport required");
  expect(candidate?.network==="testnet"&&candidate.networkPassphrase===TESTNET_PASSPHRASE,
    "canonical Testnet only");
  expect(isStellarContractId(candidate.spotContractId)&&
    isStellarContractId(candidate.baseSac)&&isStellarContractId(candidate.quoteSac)&&
    candidate.spotContractId!==candidate.baseSac&&candidate.spotContractId!==candidate.quoteSac&&
    candidate.baseSac!==candidate.quoteSac,"three distinct checksum-valid C addresses required");
  expect([candidate.spotOwner,candidate.otherTrader,candidate.quoteIssuer].every(isStellarGAddress)&&
    candidate.spotOwner!==candidate.otherTrader,"distinct valid G accounts required");
  expect(HEX.test(candidate.spotWasmSha256)&&HEX.test(candidate.spotDeployTx),
    "verified hash-shaped public deployment references required");
  const expectedXlm=Asset.native().contractId(TESTNET_PASSPHRASE);
  const expectedUsdc=new Asset(candidate.quote,candidate.quoteIssuer).contractId(TESTNET_PASSPHRASE);
  expect(expectedXlm===candidate.baseSac&&expectedUsdc===candidate.quoteSac,
    "Stellar SDK Testnet SAC derivation disagrees with candidate token contracts");
  const network=await server.getNetwork();
  expect(network?.passphrase===Networks.TESTNET,
    "Stellar RPC endpoint returned wrong network passphrase");
  const deployed=await server.getContractInstance(candidate.spotContractId);
  expect(codeHashFromInstance(deployed)===candidate.spotWasmSha256,
    "deployed M9 WASM code hash does not match reviewed binary");
  const [admin,paused,baseDecimals,quoteDecimals,baseAllowed,quoteAllowed]=await Promise.all([
    server.queryContract(candidate.spotContractId,"admin").then(r=>requireRead(r,"admin")),
    server.queryContract(candidate.spotContractId,"paused").then(r=>requireRead(r,"paused")),
    server.queryContract(candidate.baseSac,"decimals").then(r=>requireRead(r,"XLM decimals")),
    server.queryContract(candidate.quoteSac,"decimals").then(r=>requireRead(r,"USDC decimals")),
    server.queryContract(candidate.spotContractId,"allowed",{asset:candidate.baseSac}).then(r=>requireRead(r,"XLM allowlist")),
    server.queryContract(candidate.spotContractId,"allowed",{asset:candidate.quoteSac}).then(r=>requireRead(r,"USDC allowlist")),
  ]);
  expect(admin===candidate.spotOwner,"contract administrator does not match wallet 1");
  expect(typeof paused==="boolean","paused must be a strict boolean");
  expect((baseDecimals===7||baseDecimals===7n)&&
    (quoteDecimals===7||quoteDecimals===7n),"both token contracts must expose 7 decimals");
  expect(typeof baseAllowed==="boolean"&&typeof quoteAllowed==="boolean",
    "token allowlist reads must be strict booleans");
  const [makerRaw,takerRaw]=await Promise.all([
    horizonAccount(fetchImpl,candidate.spotOwner),
    horizonAccount(fetchImpl,candidate.otherTrader)
  ]);
  const maker=plainInfo(makerRaw,candidate.spotOwner,candidate);
  const taker=plainInfo(takerRaw,candidate.otherTrader,candidate);
  const blockers=[];
  if(!maker.usdcTrustlinePresent)blockers.push("Wallet 1 must sign Circle TESTNET USDC trustline creation");
  if(!taker.usdcTrustlinePresent)blockers.push("Wallet 2 must sign Circle TESTNET USDC trustline creation");
  if(maker.usdcTrustlinePresent&&!maker.usdcTrustlineAuthorized)
    blockers.push("Wallet 1 USDC trustline exists but is not authorized");
  if(taker.usdcTrustlinePresent&&!taker.usdcTrustlineAuthorized)
    blockers.push("Wallet 2 USDC trustline exists but is not authorized");
  if(BigInt(taker.usdcE7)===0n)
    blockers.push("Wallet 2 needs valueless Testnet USDC to buy Testnet XLM");
  if(BigInt(maker.xlmE7)<=10_000_000n)
    blockers.push("Wallet 1 needs a safe native Testnet XLM reserve and inventory");
  if(BigInt(taker.xlmE7)<=10_000_000n)
    blockers.push("Wallet 2 needs a safe Testnet XLM transaction-fee reserve");
  if(!baseAllowed)blockers.push("Admin must separately review and sign XLM SAC asset approval");
  if(!quoteAllowed)blockers.push("Admin must separately review and sign USDC SAC asset approval");
  if(paused)blockers.push("Admin must sign reviewed M9 unpause only after funding and safety checks");
  // This read-only module NEVER authorizes execution even if the checklist clears.
  return Object.freeze({
    milestone:"M41",network:"Stellar Testnet",
    contractId:candidate.spotContractId,
    wasmHashVerified:true,ownerVerified:true,
    deployedReadOnly:true,baseSac:expectedXlm,quoteSac:expectedUsdc,
    baseTokenDecimals:7,quoteTokenDecimals:7,
    contractPaused:paused,baseAllowed,quoteAllowed,
    wallets:Object.freeze([maker,taker]),
    blockers:Object.freeze(blockers),
    userSignaturesStillRequired:true,
    tradingEnabled:false,executePermitted:false,
    realSignedTradeVerified:false,confirmedVolumeE7:"0",
    state:blockers.length?"BLOCKED_FREIGHTER_ASSET_SETUP":"ASSETS_PREPARED_PENDING_INDEPENDENT_SIGNED_SETTLEMENT",
  });
}

export async function probeM41SpotAssets({fetchImpl=fetch}={}){
  const server=new rpc.Server(TESTNET_CONFIG.rpc);
  return checkM41SpotAssetReadiness({server,fetchImpl});
}
