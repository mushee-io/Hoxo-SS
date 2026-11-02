/**
 * M45 transient, explicitly user-clicked two-wallet signing lab.
 * No submit method. Any change of account, chain, ledger freshness or
 * M9 pause status cancels the signing session. NEVER saves signed XDR.
 */
import {createDualWalletHandoff,TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";
import {createM44EnvelopePreparer,verifyM44TakerAuth,verifyM44MakerEnvelope} from "./m44-stellar-xdr-verifier.mjs";
import {probeM45TestnetPreflight} from "./m45-spot-preflight.mjs";
import {simulateM45BilateralSpot} from "./m45-spot-simulation.mjs";
import {m52ReviewedSpotSettlement,M52_SEND_ACK} from "./m52-testnet-spot-finality.mjs";

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
  simulate=(proof,amounts)=>simulateM45BilateralSpot({server,preflight:proof,...amounts}),
  submitReviewed=m52ReviewedSpotSettlement
}={}){
  if(typeof submitReviewed!=="function")fail("reviewed Testnet submission adapter required");
  if(!adapter||typeof adapter.getAddress!=="function"||typeof adapter.getNetwork!=="function"||
      typeof adapter.signAuthEntry!=="function"||typeof adapter.signTransaction!=="function")
    fail("reviewed M44 Freighter adapter required");
  let phase="IDLE",session=null,handoff=null,lastProof=null,busy=false,finished=false;
  let confirmed=null;
  function snapshot(){
    return Object.freeze({phase,checked:Boolean(lastProof),paused:lastProof?.contractPaused??null,
      ledger:lastProof?.ledger??null,readyForSimulation:ready(lastProof),
      takerSigned:phase==="TAKER_SIGNED"||phase==="SIGNED_NOT_SENT",
      makerSigned:phase==="SIGNED_NOT_SENT",
      transactionHash:phase==="SETTLED"?confirmed?.transactionHash??null:null,
      settledLedger:phase==="SETTLED"?confirmed?.settledLedger??null:null,
      confirmedVolumeE7:phase==="SETTLED"?confirmed?.confirmedVolumeE7??"0":"0",
      verifiedOnChain:phase==="SETTLED",
      broadcast:phase==="SETTLED",executionPermitted:false});
  }
  function invalidate(){session=null;handoff=null;finished=false;confirmed=null;phase="IDLE";}
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
    async prepare({acknowledged,xlmAmount,usdcAmount,side="sell"}={}){
      return locked(async()=>{
        if(acknowledged!==true)fail("explicit bilateral Testnet terms acknowledgement required");
        if(!["buy","sell"].includes(side))fail("unknown XLM Buy/Sell side");
        invalidate();
        const proof=await ensureSigningProof();
        const candidate=await simulate(proof,{xlmAmount,usdcAmount,side});
        if(candidate?.terms?.maker_side!==(side==="buy"?1:0))
          fail("simulation returned wrong requested Buy/Sell side");
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
        session={...session,signedTakerAuthEntry:result.signedAuthEntry};
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
        session={...session,signedTxXdr:result.signedTxXdr};
        phase="SIGNED_NOT_SENT";finished=true;
        // Signed XDR stays in transient memory, never localStorage or DOM.
        return snapshot();
      });
    },
    async submit({acknowledgement}={}){
      // This method can only be called by an explicit post-signature user
      // action; no timers, retries or auto-submissions.
      return locked(async()=>{
        if(phase!=="SIGNED_NOT_SENT"||!finished||
           !session?.signedTakerAuthEntry||!session?.signedTxXdr||
           !session?.getPrepared?.())
          fail("both reviewed Freighter signatures required before Testnet submission");
        if(acknowledgement!==M52_SEND_ACK)
          fail("separate exact Testnet send confirmation required");
        const wallet=await adapter.getAddress();
        const chain=await adapter.getNetwork();
        if(wallet.address!==session.terms.maker||
           chain.networkPassphrase!==TESTNET_PASSPHRASE)
          fail("Wallet 1 must be selected on Stellar Testnet for final submission");
        const result=await submitReviewed({
          server,fetchImpl,nowMs:now(),
          sourceTxXdr:session.sourceTxXdr,
          takerAuthXdr:session.takerAuthXdr,
          signedTakerAuthEntry:session.signedTakerAuthEntry,
          preparedTxXdr:session.getPrepared(),
          signedTxXdr:session.signedTxXdr,
          expectedTerms:session.terms,
          acknowledgement,send:true
        });
        if(result?.phase!=="ONCHAIN_SETTLED_AND_RECONCILED"||
           result.actualOnchainSettlement!==true||
           !/^[a-f0-9]{64}$/i.test(result.transactionHash??"")||
           result.observedBalancesReconciled!==true)
          fail("Stellar Testnet settlement was not independently confirmed");
        confirmed=Object.freeze({
          transactionHash:result.transactionHash,
          settledLedger:result.settledLedger,
          confirmedVolumeE7:session.terms.base_amount
        });
        session=null;handoff=null;finished=false;phase="SETTLED";
        return snapshot();
      });
    },
    reset(){if(busy)fail("cannot reset while wallet confirmation is pending");invalidate();return snapshot();}
  });
}
