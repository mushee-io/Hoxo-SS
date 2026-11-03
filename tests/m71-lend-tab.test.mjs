import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("M71 top-level Lend tab and deep-linkable dedicated page are actually wired",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  assert.match(html,/<button class="toplink" data-view="lend" aria-pressed="false">Lend<\/button>/);
  assert.match(html,/id="lendView"/);
  assert.match(html,/id="lendTitle">Lend &amp; Borrow/);
  assert.match(html,/id="lendSupplyTab"/);
  assert.match(html,/id="lendBorrowTab"/);
  assert.match(html,/id="lendSupplyPanel"/);
  assert.match(html,/id="lendBorrowPanel"/);
  assert.match(html,/id="lendViewNetwork"/);
  assert.match(ui,/\["trade","portfolio","lend","earn","network"\]/);
  assert.match(ui,/initialView/);
  assert.match(ui,/setLendAction\(mode\)/);
  assert.match(ui,/setView\("network"\)/);
});
test("M71 lending cannot claim deposits, APYs, TVL or live borrowing without a verified Soroban pool",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const segment=html.slice(html.indexOf('<section id="lendView"'),html.indexOf('<section id="networkPanel"'));
  assert.ok(segment.length>2000);
  for(const term of ["TOTAL SUPPLIED","SUPPLY APY","BORROW APY","NOT LIVE",
    "SUPPLY · NOT LIVE","BORROW · NOT LIVE","WITHDRAW · NOT LIVE",
    "REPAY · NOT LIVE","No loan transactions are signed or broadcast"])
    assert.ok(segment.includes(term),term);
  assert.equal((segment.match(/<button type="button" disabled/g)||[]).length,4);
  assert.doesNotMatch(segment,/\b(?:12\.5|5\.25|1000000)\s*%/);
  assert.doesNotMatch(segment,/data-wallet-secret|signTransaction\(|submitTransaction\(/);
});
