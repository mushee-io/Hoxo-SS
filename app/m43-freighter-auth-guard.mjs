/**
 * M43 — non-broadcasting Stellar TESTNET M9 Freighter signing handoff.
 *
 * In the M9 transaction design the maker is the source account:
 *   - taker (non-source): signAuthEntry on the exact Soroban auth entry
 *   - maker (source): signTransaction on an envelope WITH taker's auth attached
 *
 * This intentionally does NOT decode XDR, verify signatures, simulate, attach
 * the auth tree itself, submit, or certify a trade. A separately reviewed SDK
 * bridge must construct and inspect the prepared envelope before this is wired
 * to a browser trading UI. All returned verification flags remain false.
 */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const M9_TESTNET_CONTRACT_ID = "CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF";
const G=/^G[A-Z2-7]{55}$/;
const FIELDS=["networkPassphrase","contractId","maker","taker","sourceTxXdr","takerAuthXdr","matchId"];
function fail(message){throw new Error("M43: "+message);}

/** Transport-only canonical padded base64; NOT Soroban/XDR validation. */
function canonicalBase64(value){
  if(typeof value!=="string"||value.length<12||value.length>16384||value.length%4!==0)return false;
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))return false;
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if(value.endsWith("=="))return (alphabet.indexOf(value[value.length-3])&15)===0;
  if(value.endsWith("="))return (alphabet.indexOf(value[value.length-2])&3)===0;
  return true;
}
function exactOwnData(object,allowed,label){
  if(!object||Object.getPrototypeOf(object)!==Object.prototype)fail(label+" must be a plain object");
  const keys=Reflect.ownKeys(object);
  for(const key of keys){
    if(typeof key!=="string"||!allowed.includes(key))fail(label+" unexpected field");
    const descriptor=Object.getOwnPropertyDescriptor(object,key);
    if(!descriptor||!("value" in descriptor))fail(label+" accessors prohibited");
  }
  return keys;
}
function checkResult(result,allowed,field,label){
  exactOwnData(result,allowed,label);
  if(Object.prototype.hasOwnProperty.call(result,"error")&&result.error!=null)fail(label+" rejected by signer");
  if(!canonicalBase64(result[field]))fail(label+" invalid signed XDR");
}
export function validateDualWalletHandoff(input){
  exactOwnData(input,FIELDS,"handoff");
  for(const key of FIELDS)
    if(!Object.prototype.hasOwnProperty.call(input,key))fail("missing own field: "+key);
  if(input.networkPassphrase!==TESTNET_PASSPHRASE)fail("Testnet passphrase required");
  if(input.contractId!==M9_TESTNET_CONTRACT_ID)fail("invalid contract");
  if(typeof input.maker!=="string"||!G.test(input.maker)||
     typeof input.taker!=="string"||!G.test(input.taker)||input.maker===input.taker)
    fail("two distinct public wallets required");
  if(typeof input.matchId!=="string"||!/^([a-f0-9]{64})$/.test(input.matchId))fail("canonical match ID required");
  if(!canonicalBase64(input.sourceTxXdr))fail("invalid source envelope XDR");
  if(!canonicalBase64(input.takerAuthXdr))fail("invalid taker auth entry XDR");
  if(input.sourceTxXdr===input.takerAuthXdr)fail("envelope and auth entry must differ");
  return Object.freeze(Object.fromEntries(FIELDS.map(k=>[k,input[k]])));
}
/**
 * The caller must supply:
 *   freighter.getAddress(): Promise<{address}>
 *   freighter.getNetwork(): Promise<{networkPassphrase}>
 *   freighter.signAuthEntry(authXdr,{address,networkPassphrase})
 *     -> Promise<{signedAuthEntry,signerAddress?,error?}>
 *   freighter.signTransaction(txXdr,{address,networkPassphrase})
 *     -> Promise<{signedTxXdr,signerAddress?,error?}>
 *   prepareEnvelope({sourceTxXdr,signedTakerAuthEntry,networkPassphrase,
 *                    contractId,maker,taker,matchId})
 *     -> Promise<{preparedTxXdr}>
 *
 * prepareEnvelope is a *separate*, independently reviewed SDK responsibility:
 * attach and verify the taker's exact signed Soroban authorization to the
 * simulated M9 operation, then build an envelope for maker/source signing.
 * This guard only checks transport/role order, NEVER cryptographic validity.
 */
export function createDualWalletHandoff(input,freighter,prepareEnvelope){
  const terms=validateDualWalletHandoff(input);
  if(!freighter||["getAddress","getNetwork","signAuthEntry","signTransaction"].some(m=>typeof freighter[m]!=="function"))
    fail("reviewed Freighter adapter with auth and envelope signing required");
  if(typeof prepareEnvelope!=="function")fail("reviewed envelope preparation callback required");
  let next="taker";
  let pending=false;
  let signedTakerAuthEntry=null;
  let approvalCount=0;

  async function requireWallet(address,phase){
    const network=await freighter.getNetwork();
    if(!network||network.networkPassphrase!==TESTNET_PASSPHRASE)fail("wallet must remain on Testnet ("+phase+")");
    const selected=await freighter.getAddress();
    if(!selected||selected.address!==address)fail("switch Freighter to the exact wallet "+address+" ("+phase+")");
  }
  return Object.freeze({
    get nextRole(){return next;},
    async approve(role){
      if(role!==next||!(role==="taker"||role==="maker"))fail("approval out of order or already completed");
      if(pending)fail("approval already in progress");
      pending=true;
      try{
        const address=terms[role];
        await requireWallet(address,"before signing");
        if(role==="taker"){
          const result=await freighter.signAuthEntry(terms.takerAuthXdr,{
            address,networkPassphrase:TESTNET_PASSPHRASE
          });
          checkResult(result,["signedAuthEntry","signerAddress","error"],"signedAuthEntry","taker authorization");
          if(result.signerAddress!==undefined&&result.signerAddress!==address)
            fail("taker signer address mismatch");
          if(result.signedAuthEntry===terms.takerAuthXdr)fail("unchanged unsigned taker authorization");
          await requireWallet(address,"after signing");
          signedTakerAuthEntry=result.signedAuthEntry;
          next="maker";
          approvalCount=1;
          return Object.freeze({role,signatureType:"sorobanAuthEntry",
            publicAddress:address,signedAuthEntry:result.signedAuthEntry,verified:false,broadcast:false});
        }
        if(!signedTakerAuthEntry)fail("taker authorization required before source envelope");
        const assembly=await prepareEnvelope(Object.freeze({
          sourceTxXdr:terms.sourceTxXdr,
          signedTakerAuthEntry,
          networkPassphrase:TESTNET_PASSPHRASE,
          contractId:M9_TESTNET_CONTRACT_ID,
          maker:terms.maker,taker:terms.taker,matchId:terms.matchId
        }));
        exactOwnData(assembly,["preparedTxXdr"],"prepared envelope");
        if(!canonicalBase64(assembly.preparedTxXdr)||assembly.preparedTxXdr===terms.sourceTxXdr)
          fail("valid auth-attached envelope preparation required");
        // Do not sign with a different account selected during async assembly.
        await requireWallet(address,"after envelope preparation");
        const result=await freighter.signTransaction(assembly.preparedTxXdr,{
          address,networkPassphrase:TESTNET_PASSPHRASE
        });
        checkResult(result,["signedTxXdr","signerAddress","error"],"signedTxXdr","maker envelope");
        if(result.signerAddress!==undefined&&result.signerAddress!==address)
          fail("maker signer address mismatch");
        if(result.signedTxXdr===assembly.preparedTxXdr)fail("unchanged unsigned maker envelope");
        await requireWallet(address,"after signing");
        next=null;
        approvalCount=2;
        return Object.freeze({role,signatureType:"transactionEnvelope",
          publicAddress:address,signedTxXdr:result.signedTxXdr,verified:false,broadcast:false});
      }finally{pending=false;}
    },
    get status(){return Object.freeze({nextRole:next,approvalCount,verified:false,broadcast:false});}
  });
}
