import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectM69RpcDiagnosticShape} from "../app/m45-spot-simulation.mjs";

test("M75 diagnostic module parses and classifies decimal RPC resource fees",()=>{
  const result=inspectM69RpcDiagnosticShape({toEnvelope(){throw Error("unavailable");}},{
    minResourceFee:"22564708",transactionData:"AAAA",cost:{cpuInsns:1}
  });
  assert.equal(result.minResourceFeeKind,"decimal-string");
  assert.equal(result.transactionDataKind,"encoded-string");
  assert.equal(result.costKind,"object");
  assert.equal(result.envelope,"unavailable");
  assert.equal(JSON.stringify(result).includes("22564708"),false);
});

test("M75 diagnostic source cannot contain literal escaped newline tokens",()=>{
  const source=readFileSync(new URL("../app/m45-spot-simulation.mjs",import.meta.url),"utf8");
  assert.equal(source.includes(String.raw`?\n    (`),false);
  assert.equal(source.includes(String.raw`?\n      `),false);
  assert.match(source,/minResourceFeeKind:kind/);
});
