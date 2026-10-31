import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {TESTNET} from "../assets/testnet-status.mjs";
import {HORIZON,FRIENDBOT,isStellarGAddress,verifyWalletNetwork,normalizeBalances,loadTestnetAccount,createWalletSession} from "../app/wallet-core.mjs";

const ADDRESS="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const NOW=Date.parse("2026-10-31T09:00:00Z");
const network=()=>({network:"TESTNET",networkPassphrase:TESTNET.passphrase});
const snapshot=(funded=true)=>({
  account_id:ADDRESS,
  balances:funded?[{asset_type:"native",balance:"10000.0000000"}]:[],
});
const horizonRoot=()=>({
  network_passphrase:TESTNET.passphrase,
  history_latest_ledger:5000000,
  history_latest_ledger_closed_at:new Date(NOW-5000).toISOString(),
});
function makeApi({wrongNetwork=false,connected=true,address=ADDRESS}={}){
  return {
    async isConnected(){return {isConnected:connected};},
    async requestAccess(){return {address};},
    async getNetwork(){return wrongNetwork
      ?{network:"PUBLIC",networkPassphrase:"Public Global Stellar Network ; September 2015"}
      :network();},
    async getAddress(){return {address};}
  };
}
function fetcher({funded=true,wrongAccount=false,stale=false,throwNetwork=false}={}){
  const log=[];
  const fn=async(url)=>{
    log.push(url);
    if(url===HORIZON+"/"){
      if(throwNetwork)throw Error("Network offline");
      return {ok:true,status:200,json:async()=>({
        ...horizonRoot(),
        history_latest_ledger_closed_at:new Date(NOW-(stale?999999:5000)).toISOString()
      })};
    }
    if(url.startsWith(HORIZON+"/accounts/")){
      if(!funded)return {ok:false,status:404};
      return {ok:true,status:200,json:async()=>({
        ...snapshot(),account_id:wrongAccount?"GOTHER":ADDRESS
      })};
    }
    throw Error("Unexpected URL: "+url);
  };
  return {fn,log};
}

test("M3 validates Stellar G accounts with version byte and checksum",()=>{
  assert.equal(isStellarGAddress(ADDRESS),true);
  assert.equal(isStellarGAddress(ADDRESS.slice(0,-1)+"G"),false);
  assert.equal(isStellarGAddress("S"+ADDRESS.slice(1)),false);
  assert.equal(isStellarGAddress("GNOTAREALADDRESS"),false);
  assert.equal(isStellarGAddress(null),false);
});
test("M3 rejects mainnet and futurenet, accepts only exact Testnet passphrase",()=>{
  assert.equal(verifyWalletNetwork(network()),true);
  assert.throws(()=>verifyWalletNetwork({network:"PUBLIC",networkPassphrase:"Public Global Stellar Network ; September 2015"}),/Wrong network/);
  assert.throws(()=>verifyWalletNetwork({network:"TESTNET",networkPassphrase:"other"}),/Wrong network/);
});
test("M3 Horizon balances are not invented and trustline issuer is preserved",()=>{
  const entries=normalizeBalances([
    {asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:ADDRESS,balance:"12.3400000"},
    {asset_type:"native",balance:"123.0000000"}
  ]);
  assert.equal(entries[0].asset,"XLM");
  assert.equal(entries[1].issuer,ADDRESS);
  assert.throws(()=>normalizeBalances([{asset_type:"native",balance:"Infinity"}]),/Malformed/);
  assert.throws(()=>normalizeBalances([{asset_type:"credit_alphanum4",asset_code:"USDC",asset_issuer:"fake",balance:"10"}]),/trustline/);
});
test("M3 Horizon performs verified network check before account lookup",async()=>{
  const mock=fetcher();
  const data=await loadTestnetAccount(ADDRESS,{fetchImpl:mock.fn,nowMs:NOW});
  assert.equal(data.funded,true);
  assert.equal(data.balances[0].balance,"10000.0000000");
  assert.deepEqual(mock.log,[HORIZON+"/",HORIZON+"/accounts/"+ADDRESS]);
});
test("M3 wrong identity, stale network and offline errors fail closed",async()=>{
  for (const bad of [{wrongAccount:true},{stale:true},{throwNetwork:true}]) {
    const mock=fetcher(bad);
    await assert.rejects(()=>loadTestnetAccount(ADDRESS,{fetchImpl:mock.fn,nowMs:NOW}));
  }
  await assert.rejects(()=>loadTestnetAccount("not-an-account",{fetchImpl:fetcher().fn,nowMs:NOW}),/Invalid/);
});
test("M3 unfunded Stellar account is distinct from network failure",async()=>{
  const mock=fetcher({funded:false});
  const result=await loadTestnetAccount(ADDRESS,{fetchImpl:mock.fn,nowMs:NOW});
  assert.equal(result.funded,false);
  assert.deepEqual(result.balances,[]);
  assert.equal(result.ledger,5000000);
});
test("M3 successful Freighter connection reads Horizon and never signs",async()=>{
  const records=[];
  const session=createWalletSession({
    api:makeApi(),fetchImpl:fetcher().fn,now:()=>NOW,onChange:s=>records.push(s)
  });
  const state=await session.connect();
  assert.equal(state.status,"connected");
  assert.equal(state.address,ADDRESS);
  assert.equal(state.balances.length,1);
  assert.equal(state.ledger,5000000);
  assert.match(state.message,/Not exchange collateral/);
  assert.ok(records.some(s=>s.status==="connecting"));
  assert.equal(session.disconnect().status,"disconnected");
  assert.equal(session.snapshot().address,null);
  assert.deepEqual(session.snapshot().balances,[]);
});
test("M3 Freighter wrong network refuses connection and no Horizon request is sent",async()=>{
  const mock=fetcher();
  const session=createWalletSession({api:makeApi({wrongNetwork:true}),fetchImpl:mock.fn,now:()=>NOW});
  const state=await session.connect();
  assert.equal(state.status,"wrong-network");
  assert.equal(state.address,null);
  assert.equal(mock.log.length,0);
});
test("M3 missing extension and denied access fail without a stored account",async()=>{
  const session=createWalletSession({api:makeApi({connected:false}),fetchImpl:fetcher().fn,now:()=>NOW});
  assert.equal((await session.connect()).status,"error");
  const denied=makeApi();
  denied.requestAccess=async()=>({error:{message:"denied"}});
  const another=createWalletSession({api:denied,fetchImpl:fetcher().fn,now:()=>NOW});
  assert.equal((await another.connect()).status,"error");
  assert.equal(another.snapshot().address,null);
});
test("M3 refresh clears balances when network or account changes",async()=>{
  let wrong=false,account=ADDRESS;
  const api=makeApi();
  api.getNetwork=async()=>wrong?{network:"PUBLIC",networkPassphrase:"Public Global Stellar Network ; September 2015"}:network();
  api.getAddress=async()=>({address:account});
  const session=createWalletSession({api,fetchImpl:fetcher().fn,now:()=>NOW});
  await session.connect();
  wrong=true;
  const next=await session.refresh();
  assert.equal(next.status,"wrong-network");
  assert.deepEqual(next.balances,[]);
  assert.equal(next.address,null);
});
test("M3 faucet only for explicitly unfunded Testnet account, verifies Horizon after request",async()=>{
  let funded=false,requests=0;
  const fetchImpl=async(url)=>{
    if(url===HORIZON+"/")return {ok:true,status:200,json:async()=>horizonRoot()};
    if(url===HORIZON+"/accounts/"+ADDRESS) return funded
      ?{ok:true,status:200,json:async()=>snapshot()}
      :{ok:false,status:404};
    if(url===FRIENDBOT+"/?addr="+ADDRESS){
      requests++;funded=true;return {ok:true,status:200,json:async()=>({hash:"test"})};
    }
    throw Error("unexpected "+url);
  };
  const session=createWalletSession({api:makeApi(),fetchImpl,now:()=>NOW});
  assert.equal((await session.connect()).status,"unfunded");
  assert.equal(requests,0,"Connecting never requests faucet");
  assert.equal((await session.fund()).status,"connected");
  assert.equal(requests,1);
  await assert.rejects(()=>session.fund(),/only available for an unfunded/);
});
test("M3 unverified network blocks faucet even when previously unfunded",async()=>{
  let wrong=false,requests=0;
  const api=makeApi();
  api.getNetwork=async()=>wrong?{network:"PUBLIC",networkPassphrase:"Public Global Stellar Network ; September 2015"}:network();
  const mock=async(url)=>{
    if(url.startsWith(FRIENDBOT))requests++;
    if(url===HORIZON+"/")return {ok:true,status:200,json:async()=>horizonRoot()};
    if(url===HORIZON+"/accounts/"+ADDRESS)return {ok:false,status:404};
    throw Error("no endpoint");
  };
  const session=createWalletSession({api,fetchImpl:mock,now:()=>NOW});
  await session.connect();wrong=true;
  const after=await session.fund();
  assert.equal(after.status,"wrong-network");
  assert.equal(requests,0);
});
test("M3 UI does not import signer methods or claim deployed custody",async()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const html=await readFile(resolve(root,"app/index.html"),"utf8");
  const wallet=await readFile(resolve(root,"app/wallet-ui.mjs"),"utf8");
  const core=await readFile(resolve(root,"app/wallet-core.mjs"),"utf8");
  for(const id of ["walletButton","walletStatus","refreshWallet","copyWallet","faucetButton","faucetConfirm","confirmFaucet","cancelFaucet","walletExplorer"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/<script src="\.\/wallet-ui\.mjs" type="module"><\/script>/);
  assert.match(html,/disabled>DEPOSIT/);
  assert.match(html,/disabled>WITHDRAW/);
  assert.doesNotMatch(wallet+core,/signTransaction|submitTransaction|signAuthEntry|secretKey|Keypair\.fromSecret/);
  assert.doesNotThrow(()=>execFileSync(process.execPath,["--check",resolve(root,"app/wallet-ui.mjs")],{stdio:"pipe"}));
});
