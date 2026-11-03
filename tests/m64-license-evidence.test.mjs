import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("M64 repository license is complete and correctly attributed", async () => {
  const license=await readFile(new URL("../LICENSE",import.meta.url),"utf8");
  assert.match(license,/^MIT License\n/);
  assert.match(license,/Copyright \(c\) 2026 Mushee/);
  assert.match(license,/Permission is hereby granted, free of charge/);
  assert.match(license,/The above copyright notice and this permission notice shall be included/);
  assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
});

test("M64 release evidence distinguishes simulations, receipts and deployment",async()=>{
  const doc=await readFile(new URL("../docs/m64-testnet-evidence-and-release.md",import.meta.url),"utf8");
  for(const requirement of ["two distinct consenting Testnet wallets","successful transaction receipt",
    "token-balance reconciliation","canonical solvency/liquidation",
    "zero verified Hoxo spot settlements","not a live claim","independent security review"])
    assert.ok(doc.includes(requirement),requirement);
  assert.match(doc,/No private keys, signing or transaction submission in CI/);
});
