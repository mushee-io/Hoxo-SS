import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("Hoxo Lend tab remains deep-linkable and offers the requested external destination",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  const css=await readFile(new URL("../app/terminal.css",import.meta.url),"utf8");
  assert.match(html,/<button class="toplink" data-view="lend" aria-pressed="false">Lend<\/button>/);
  assert.match(html,/id="lendView"/);
  assert.match(html,/class="lend-entry-card" href="https:\/\/hoxo-lend\.vercel\.app\/"/);
  assert.match(html,/class="lend-entry-mark"/);
  assert.match(html,/id="lendTitle">Enter the Lend Market/);
  assert.match(html,/Proceed with caution\./);
  assert.match(html,/ENTER LEND MARKET/);
  assert.match(css,/\.lend-entry-card:hover/);
  assert.match(css,/\.lend-entry-card:focus-visible/);
  assert.match(ui,/\["trade","portfolio","lend","earn","network"\]/);
  assert.match(ui,/initialView/);
  assert.match(ui,/\$\("lendView"\)\.classList\.toggle\("hidden",view!=="lend"\)/);
});

test("Hoxo Lend portal does not imply lending is executed inside the exchange",async()=>{
  const html=await readFile(new URL("../app/index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("../app/terminal-ui.mjs",import.meta.url),"utf8");
  const segment=html.slice(html.indexOf('<section id="lendView"'),html.indexOf('<section id="networkPanel"'));
  assert.ok(segment.length>400);
  assert.equal((segment.match(/href="https:\/\/hoxo-lend\.vercel\.app\/"/g)||[]).length,1);
  for(const legacy of ["lendSupplyTab","lendBorrowTab","lendSupplyPanel","lendBorrowPanel","lendViewNetwork"])
    assert.ok(!html.includes('id="'+legacy+'"'),legacy);
  assert.doesNotMatch(segment,/\b(?:TVL|APY|BORROW APY|TOTAL SUPPLIED)\b/);
  assert.doesNotMatch(segment,/signTransaction\(|submitTransaction\(|data-wallet-secret|<button/);
  assert.doesNotMatch(ui,/setLendAction\(|lendViewNetwork/);
});
