/**
 * M45 transient, explicitly user-clicked two-wallet signing lab.
 * No submit method. Any change of account, chain, ledger freshness or
 * M9 pause status cancels the signing session. NEVER saves signed XDR.
 */
import {createDualWalletHandoff,TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";
import {createM44EnvelopePreparer,verifyM44TakerAuth,verifyM44MakerEnvelope} from "./m44-stellar-xdr-verifier.mjs";
import {probeM45TestnetPreflight} from "./m45-spot-preflight.mjs";
import {simulateM45BilateralSpot} from "./m45-spot-simulation.mjs";

const PROOF_TTL_MS=20000;
function fail(message){throw Error("M45 signing lab: "+message);}
function ready(proof){
  return proof&&proof.network==="Stellar Testnet"&&
    proof.contract===M9_TESTNET_CONTRACT_ID&&proof.verifiedWasm===true&&
    proof.contractPaused===false&&proof.baseAllowed===true&&proof.quoteAllowed===true&&
    proof.readyForSimulation===true&&Array.isArray(proof.wallets)&&
    proof.wallets.length===2&&proof.wallets.every(w=>w.trustlineAuthorized===true);
}
export function createM45SigningLab({
  server,fetchImpl=fetch,now=()=>Date.now(),adapter,
  probe=()=>probeM45TestnetPreflight({server,fetchImpl,nowMs:now()}),
  simulate=(proof,amounts)=>simulateM45BilateralSpot({server,preflight:proof,...amounts})
}={}){
  if(!adapter||typeof adapter.getAddress!=="function"||typeof adapter.getNetwork!=="function"||
      typeof adapter.signAuthEntry!=="function"||typeof adapter.signTransaction!=="function")
    fail("reviewed M44 Freighter adapter required");
  let phase="IDLE",session=null,handoff=null,lastProof=null,busy=false,finished=false;
  function snapshot(){
    return Object.freeze({phase,checked:Boolean(lastProof),paused:lastProof?.contractPaused??null,
      ledger:lastProof?.ledger??null,readyForSimulation:ready(lastProof),
      takerSigned:phase==="TAKER_SIGNED"||phase==="SIGNED_NOT_SENT",
      makerSigned:phase==="SIGNED_NOT_SENT",
      transactionHash:null,confirmedVolumeE7:"0",
      verifiedOnChain:false,broadcast:false,executionPermitted:false});
  }
  function invalidate(){session=null;handoff=null;finished=false;phase="IDLE";}
  async function locked(action){
    if(busy)fail("another signing action is still running");
    busy=true;
    try{return await action();}
    catch(error){invalidate();throw error;}
    finally{busy=false;}
  }
  async function liveProof(){
    const proof=await probe();
    if(!proof||!Number.isSafeInteger(proof.observedAtMs)||
       now()-proof.observedAtMs>PROOF_TTL_MS||proof.observedAtMs>now()+1000)
      fail("fresh independent RPC/Horizon preflight required");
    lastProof=proof;
    return proof;
  }
  async function ensureSigningProof(){
    const p=await liveProof();
    if(!ready(p))fail("M9 is paused, assets unavailable or chain unverified; signing blocked");
    if(session&&(p.ledger<session.currentLedger||p.ledger>session.terms.expires_at_ledger||
      p.ledger-session.currentLedger>20))
      fail("signing terms expired or ledger changed; prepare a fresh simulation");
    return p;
  }
  return Object.freeze({
    snapshot,
    async check(){
      return locked(async()=>{
        invalidate();
        const proof=await liveProof();
        phase=ready(proof)?"REVIEW_ONLY":"BLOCKED";
        return Object.freeze({...snapshot(),blockers:proof.blockers,
          wasmVerified:proof.verifiedWasm,baseAllowed:proof.baseAllowed,
          quoteAllowed:proof.quoteAllowed,watchedWallets:proof.wallets});
      });
    },
    async prepare({acknowledged,xlmAmount,usdcAmount}={}){
      return locked(async()=>{
        if(acknowledged!==true)fail("explicit bilateral Testnet terms acknowledgement required");
        invalidate();
        const proof=await ensureSigningProof();
        const candidate=await simulate(proof,{xlmAmount,usdcAmount});
        if(candidate?.simulated!==true||candidate.broadcast!==false||
           candidate.terms?.maker!==proof.wallets[0].address||
           candidate.terms?.taker!==proof.wallets[1].address||
           Math.abs(candidate.currentLedger-proof.ledger)>4)
          fail("simulation not bound to fresh exact wallets and ledger");
        session=candidate;
        const basicInput=Object.freeze({
          networkPassphrase:TESTNET_PASSPHRASE,contractId:M9_TESTNET_CONTRACT_ID,
          maker:candidate.terms.maker,taker:candidate.terms.taker,
          sourceTxXdr:candidate.sourceTxXdr,takerAuthXdr:candidate.takerAuthXdr,
          matchId:candidate.terms.match_id
        });
        let preparedTxXdr=null;
        const prepareEnvelope=createM44EnvelopePreparer({
          expectedTerms:candidate.terms,currentLedger:candidate.currentLedger,
          takerAuthXdr:candidate.takerAuthXdr
        });
        handoff=createDualWalletHandoff(basicInput,adapter,async request=>{
          const output=await prepareEnvelope(request);
          preparedTxXdr=output.preparedTxXdr;
          return output;
        });
        // Store the signed maker envelope's preparation XDR only in memory.
        session={...session,getPrepared:()=>preparedTxXdr};
        phase="SIMULATED";
        return Object.freeze({...snapshot(),terms:session.terms,feeStroops:session.feeStroops,
          bilateralPriceIsUserSupplied:true,simulatedOnly:true});
      });
    },
    async approveTaker({acknowledged}={}){
      return locked(async()=>{
        if(phase!=="SIMULATED"||!handoff||acknowledged!==true)
          fail("explicit Wallet 2 confirmation and simulation required");
        const proof=await ensureSigningProof();
        const result=await handoff.approve("taker");
        const verified=verifyM44TakerAuth({
          sourceTxXdr:session.sourceTxXdr,takerAuthXdr:session.takerAuthXdr,
          signedTakerAuthEntry:result.signedAuthEntry,expectedTerms:session.terms,
          currentLedger:proof.ledger
        });
        if(!verified.signatureVerified||verified.signer!==session.terms.taker)
          fail("Wallet 2 cryptographic authorization missing");
        phase="TAKER_SIGNED";
        return snapshot();
      });
    },
    async approveMaker({acknowledged}={}){
      return locked(async()=>{
        if(phase!=="TAKER_SIGNED"||!handoff||acknowledged!==true)
          fail("explicit Wallet 1 confirmation and verified taker signature required");
        await ensureSigningProof();
        const result=await handoff.approve("maker");
        const prepared=session.getPrepared();
        if(!prepared)fail("auth-attached envelope was not constructed");
        const checked=verifyM44MakerEnvelope({preparedTxXdr:prepared,
          signedTxXdr:result.signedTxXdr,maker:session.terms.maker});
        if(!checked.signatureVerified||!checked.transactionBodyVerified)
          fail("Wallet 1 envelope signature not verified");
        phase="SIGNED_NOT_SENT";finished=true;
        // No serialization, no wallet secret, no sendTransaction, no RPC writes.
        // Signature is deliberately never returned to the page or persisted.
        return snapshot();
      });
    },
    reset(){if(busy)fail("cannot reset while wallet confirmation is pending");invalidate();return snapshot();}
  });
}
