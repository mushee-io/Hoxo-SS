/**
 * M43 browser-only, user-controlled dual-wallet Soroban authorization handoff.
 * Never signs automatically, never broadcasts, and never accepts a secret key.
 * Freighter API adapter must be supplied by the browser UI after independent review.
 */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const G=/^G[A-Z2-7]{55}$/;
const C=/^C[A-Z2-7]{55}$/;
function fail(message){throw new Error("M43: "+message);}
export function validateDualWalletHandoff(input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype)fail("plain input object required");
  const allowed=new Set(["networkPassphrase","contractId","maker","taker","makerAuthXdr","takerAuthXdr","matchId"]);
  for(const key of Reflect.ownKeys(input)){
    if(typeof key!=="string"||!allowed.has(key))fail("unexpected field");
    const d=Object.getOwnPropertyDescriptor(input,key);
    if(!d||!("value" in d))fail("accessors prohibited");
  }
  if(input.networkPassphrase!==TESTNET_PASSPHRASE)fail("Testnet passphrase required");
  if(typeof input.contractId!=="string"||!C.test(input.contractId))fail("invalid contract");
  if(typeof input.maker!=="string"||!G.test(input.maker)||typeof input.taker!=="string"||!G.test(input.taker)||input.maker===input.taker)fail("two distinct public wallets required");
  if(typeof input.matchId!=="string"||!/^([a-f0-9]{64})$/.test(input.matchId))fail("canonical match ID required");
  for(const role of ["maker","taker"]){
    const xdr=input[role+"AuthXdr"];
    if(typeof xdr!=="string"||xdr.length<12||xdr.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(xdr))fail("invalid auth entry XDR");
  }
  return Object.freeze({networkPassphrase:input.networkPassphrase,contractId:input.contractId,maker:input.maker,taker:input.taker,makerAuthXdr:input.makerAuthXdr,takerAuthXdr:input.takerAuthXdr,matchId:input.matchId});
}
/**
 * One approval per distinct wallet, sequentially, with explicit per-role click.
 * Caller supplies a reviewed Freighter adapter. No persistence, no transaction submit.
 * Adapter contract: getAddress(): Promise<{address:string}>,
 * getNetwork(): Promise<{networkPassphrase:string}>, signAuthEntry(xdr, {address,networkPassphrase}).
 */
export function createDualWalletHandoff(input,freighter){
  const terms=validateDualWalletHandoff(input);
  if(!freighter||typeof freighter.getAddress!=="function"||typeof freighter.getNetwork!=="function"||typeof freighter.signAuthEntry!=="function")fail("reviewed Freighter adapter required");
  let next="maker";
  let pending=false;
  const signatures=Object.create(null);
  return Object.freeze({
    get nextRole(){return next;},
    async approve(role){
      if(role!==next||!(role==="maker"||role==="taker"))fail("approval out of order or already completed");
      if(pending)fail("approval already in progress");
      pending=true;
      try {
      const expected=terms[role];
      const network=await freighter.getNetwork();
      if(!network||network.networkPassphrase!==TESTNET_PASSPHRASE)fail("wallet must be on Testnet");
      const account=await freighter.getAddress();
      if(!account||account.address!==expected)fail("switch Freighter to the exact "+role+" public wallet");
      const result=await freighter.signAuthEntry(terms[role+"AuthXdr"],{address:expected,networkPassphrase:TESTNET_PASSPHRASE});
      if(!result||typeof result.signedAuthEntry!=="string"||!result.signedAuthEntry.length||result.error)fail("Freighter authorization not returned");
      // Never assume signedAuthEntry proves the signature: caller must independently
      // verify its decoded Soroban credentials, invocation tree and expiry.
      // Reject account/network changes while the user was reviewing the prompt.
      const finalNetwork=await freighter.getNetwork();
      const finalAccount=await freighter.getAddress();
      if(!finalNetwork||finalNetwork.networkPassphrase!==TESTNET_PASSPHRASE||!finalAccount||finalAccount.address!==expected)fail("wallet or network changed during approval");
      signatures[role]=result.signedAuthEntry;
      next=role==="maker"?"taker":null;
      return Object.freeze({role,publicAddress:expected,signedAuthEntry:result.signedAuthEntry,verified:false,broadcast:false});
      } finally { pending=false; }
    },
    get status(){return Object.freeze({nextRole:next,approvalCount:Object.keys(signatures).length,verified:false,broadcast:false});}
  });
}
