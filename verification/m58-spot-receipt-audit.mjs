/** Read-only independent Stellar TESTNET spot BUY/SELL receipt verification. */
export const TESTNET_PASSPHRASE="Test SDF Network ; September 2015";
const hashPattern=/^[0-9a-f]{64}$/i;
const addressPattern=/^G[A-Z2-7]{55}$/;
function fail(s){throw Error("M58 evidence: "+s);}
function hash(s){if(s instanceof Uint8Array&&s.length===32)return Array.from(s,x=>x.toString(16).padStart(2,"0")).join("");if(typeof s!=="string"||!hashPattern.test(s))fail("invalid hash");return s.toLowerCase();}
function ledger(n){return Number.isSafeInteger(n)&&n>0;}\nfunction positiveAmount(n){return typeof n==="bigint"?n>0n:typeof n==="string"&&/^[1-9][0-9]*$/.test(n);}
export async function auditM58SpotPair({rpc,contractId,buy,sell}={}){
 if(!rpc||["getNetwork","getTransaction","queryContract"].some(k=>typeof rpc[k]!=="function"))
   fail("independent read-only RPC adapter required");
 if(typeof contractId!=="string"||!/^C[A-Z2-7]{55}$/.test(contractId))fail("invalid M9 contract");
 if((await rpc.getNetwork())?.passphrase!==TESTNET_PASSPHRASE)fail("wrong network");
 if(!buy||!sell)fail("both directions required");
 const hashes=new Set(),matches=new Set(),orders=new Set(),proofs=[];
 for(const [direction,entry,side] of [["BUY",buy,1],["SELL",sell,0]]){
  const txHash=hash(entry.txHash),matchId=hash(entry.matchId);
  if(hashes.has(txHash)||matches.has(matchId))fail("duplicate trade evidence");
  hashes.add(txHash);matches.add(matchId);
  const tx=await rpc.getTransaction(txHash);
  if(tx?.status!=="SUCCESS"||hash(tx.hash)!==txHash||!ledger(tx.ledger))
    fail("transaction finality unverified");
  const args={match_id:Uint8Array.from(matchId.match(/../g),x=>parseInt(x,16))};
  const observed=await rpc.queryContract(contractId,"receipt",args);
  if(observed?.isReadCall!==true)fail("receipt must be independent read");
  const r=observed.result;
  if(!r||hash(r.match_id)!==matchId||r.maker_side!==side||
     r.settled_ledger!==tx.ledger||
     !addressPattern.test(r.maker)||!addressPattern.test(r.taker)||
     r.maker===r.taker||
     !positiveAmount(r.base_amount)||!positiveAmount(r.quote_amount))
    fail("receipt does not match distinct-party settled trade");
  const makerOrder=hash(r.maker_order_id),takerOrder=hash(r.taker_order_id);
  if(makerOrder===takerOrder||orders.has(makerOrder)||orders.has(takerOrder))
    fail("reused order identity");
  orders.add(makerOrder);orders.add(takerOrder);
  const replay=await rpc.queryContract(contractId,"is_settled",args);
  if(replay?.isReadCall!==true||replay.result!==true)fail("settlement marker missing");
  proofs.push(Object.freeze({direction,txHash,matchId,ledger:tx.ledger,maker:r.maker,taker:r.taker}));
 }
 // Separate G-addresses do not prove different beneficial owners.
 return Object.freeze({network:"Stellar Testnet",buyAndSellOnchainVerified:true,
   volumeAttributionApproved:false,requiresOwnershipReview:true,proofs:Object.freeze(proofs)});
}
