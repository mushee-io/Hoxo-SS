/**
 * M46 Windows/Freighter acceptance — explicit, READ-ONLY account-switch QA.
 *
 * No signAuthEntry/signTransaction/requestAccess/sendTransaction calls.
 * Verify one real selected Freighter G-account at a time against a fresh,
 * independently read M45 Testnet RPC/Horizon proof. This module cannot unpause
 * M9, simulate a settlement, approve beta or broadcast a transaction.
 */
import {M45_CANDIDATE} from "./m45-spot-preflight.mjs";
import {TESTNET_PASSPHRASE,M9_TESTNET_CONTRACT_ID} from "./m43-freighter-auth-guard.mjs";

const AGE_LIMIT_MS=120_000;
const ROLES=Object.freeze({wallet1:M45_CANDIDATE.maker,wallet2:M45_CANDIDATE.taker});
function fail(reason){throw Error("M46 Windows acceptance: "+reason);}
function expectedProof(p,role,address,now){
  if(!p||p.network!=="Stellar Testnet"||p.contract!==M9_TESTNET_CONTRACT_ID||
     p.verifiedWasm!==true||!Number.isSafeInteger(p.ledger)||p.ledger<=0||
     !Number.isSafeInteger(p.observedAtMs)||p.observedAtMs>now+1000||
     now-p.observedAtMs>20000)fail("fresh verified Testnet RPC/Horizon and M9 code proof required");
  if(p.contractPaused!==true)fail("M9 pause must remain enabled for M46 read-only acceptance");
  if(p.baseAllowed!==true||p.quoteAllowed!==true)fail("M9 assets not approved");
  if(!Array.isArray(p.wallets)||p.wallets.length!==2||
     p.wallets[0]?.address!==ROLES.wallet1||p.wallets[1]?.address!==ROLES.wallet2)
    fail("canonical Wallet 1 / Wallet 2 identity mismatch");
  const wallet=p.wallets[role==="wallet1"?0:1];
  if(wallet.address!==address||wallet.trustlineAuthorized!==true)
    fail("selected wallet or USDC trustline not verified");
  const xlm=BigInt(wallet.xlmE7),usdc=BigInt(wallet.usdcE7);
  if(xlm<=10_000_000n)fail("wallet lacks the required XLM reserve");
  if(role==="wallet2"&&usdc<=0n)fail("Wallet 2 has no authorized test USDC");
  return wallet;
}
async function readFreighter(api,address){
  const network=await api.getNetwork();
  if(!network||network.networkPassphrase!==TESTNET_PASSPHRASE||
     (network.network!==undefined&&network.network!=="TESTNET"))
    fail("Freighter must be on Stellar Testnet");
  const account=await api.getAddress();
  if(!account||account.address!==address)fail("select the exact expected Freighter account");
}
export function createM46WindowsAcceptance({
  api,probe,now=()=>Date.now()
}={}){
  if(!api||typeof api.getAddress!=="function"||typeof api.getNetwork!=="function")
    fail("read-only official Freighter API required");
  if(typeof probe!=="function")fail("live read-only Testnet probe required");
  let pending=false,checks=new Map();
  function clear(){checks=new Map();}
  function summary(){
    const moment=now();
    const fresh=role=>{
      const item=checks.get(role);
      return Boolean(item&&moment>=item.at&&moment-item.at<=AGE_LIMIT_MS);
    };
    return Object.freeze({
      wallet1Verified:fresh("wallet1"),wallet2Verified:fresh("wallet2"),
      bothWalletsReviewed:fresh("wallet1")&&fresh("wallet2"),
      currentLedger:checks.get("wallet2")?.ledger??checks.get("wallet1")?.ledger??null,
      activeNetwork:"Stellar Testnet", m9Paused:true,
      signaturesRequested:false,signingPermitted:false,
      contractActivationApproved:false,executionPermitted:false,broadcast:false,
      confirmedVolumeE7:"0"
    });
  }
  return Object.freeze({
    summary,
    reset(){if(pending)fail("cannot reset during an in-flight review");clear();return summary();},
    async verify(role){
      if(!(role in ROLES)||!Object.prototype.hasOwnProperty.call(ROLES,role))
        fail("only wallet1 and wallet2 may be checked");
      if(pending)fail("another wallet review is running");
      pending=true;
      try{
        const address=ROLES[role];
        await readFreighter(api,address);
        const proof=await probe();
        const observedAt=now();
        const wallet=expectedProof(proof,role,address,observedAt);
        await readFreighter(api,address);
        checks.set(role,Object.freeze({
          at:observedAt,ledger:proof.ledger,address,
          xlmE7:wallet.xlmE7,usdcE7:wallet.usdcE7
        }));
        return Object.freeze({
          role,address,ledger:proof.ledger,
          xlmE7:wallet.xlmE7,usdcE7:wallet.usdcE7,
          trustlineAuthorized:true,contractPaused:true,
          checkedAtMs:observedAt,signatureRequested:false,
          reviewOnly:true,broadcast:false
        });
      }catch(err){
        clear(); // invalidate both on any wallet/network/proof failure
        throw err;
      }finally{pending=false;}
    }
  });
}
