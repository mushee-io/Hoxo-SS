#!/usr/bin/env node
import { resolve } from "node:path";
import { createSandboxServer } from "../matching/http.mjs";
import { SignedOrderJournal } from "../matching/journal.mjs";

const port = Number(process.env.HOXO_M8_PORT ?? 8788);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error("Invalid HOXO_M8_PORT");
const path = resolve(process.env.HOXO_M8_JOURNAL || ".data/hoxo-m8-testnet-sandbox.jsonl");
// Public operator account only. The associated private key is NEVER read by
// the server. Tick commands must arrive with an authentic wallet signature.
const tickSigner=process.env.HOXO_M17_SANDBOX_TICK_SIGNER||null;
if(tickSigner&&!/^G[A-Z2-7]{55}$/.test(tickSigner))throw Error("Invalid sandbox tick operator G-address");
const journal = await SignedOrderJournal.open(path,{tickSigner});
const server = createSandboxServer(journal);
server.listen(port, "127.0.0.1", () => {
  console.log("HOXO-SS M8 non-executable sandbox matching API at http://127.0.0.1:" + port);
  console.log("Stellar TESTNET reference only; NO funds, no actual orders or on-chain fills.");
  console.log("Append-only journal: " + path);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await new Promise(resolveClose => server.close(resolveClose));
  await journal.close();
}
for (const signal of ["SIGINT","SIGTERM"]) {
  process.on(signal,()=>shutdown().then(()=>process.exit(0)).catch(e=>{
    console.error("Shutdown error",e);process.exit(1);
  }));
}
