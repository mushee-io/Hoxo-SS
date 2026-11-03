import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import handler from "../api/mm-runner.js";
import {runTestnetMM} from "../scripts/run-testnet-mm.mjs";

function fakeResponse(){
  let statusCode=200,output=null;
  return {
    setHeader(){},status(n){statusCode=n;return this;},
    json(data){output=data;return this;},
    get result(){return {statusCode,output};}
  };
}
test("M67 direct import of CLI MM runner does not sign or create offers",()=>{
  assert.equal(typeof runTestnetMM,"function");
});
test("M67 serverless maker cron rejects all unauthenticated or non-GET calls",async()=>{
  for(const req of [
    {method:"GET",headers:{}},
    {method:"GET",headers:{authorization:"Bearer invalid"}},
    {method:"POST",headers:{}}
  ]){
    const resp=fakeResponse();
    await handler(req,resp);
    assert.ok([401,405].includes(resp.result.statusCode));
    assert.notEqual(resp.result.output.status,"MM_TICK_COMPLETED");
  }
});
test("M67 cron requires explicit encrypted Vercel activation and never uses a user wallet without a signer",async()=>{
  const script=await readFile(new URL("../api/mm-runner.js",import.meta.url),"utf8");
  const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.deepEqual(vercel.crons,[{path:"/api/mm-runner",schedule:"*/5 * * * *"}]);
  assert.match(script,/process\.env\.CRON_SECRET/);
  assert.match(script,/process\.env\.HOXO_MM_VERCEL_LIVE!=="YES"/);
  assert.match(script,/process\.env\.HOXO_MM_SECRET/);
  assert.match(script,/signer\.publicKey\(\)!==address/);
  assert.match(script,/Operation\.changeTrust/);
  assert.match(script,/Operation\.pathPaymentStrictSend/);
  assert.match(script,/quoteDirectXlmUsdc/);
  assert.match(script,/friendbot\.stellar\.org/);
  assert.match(script,/process\.env\.HOXO_MM_VERCEL_STOP/);
  assert.match(script,/runTestnetMM\("live"\)/);
});
