import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { TESTNET, validateHorizonRoot, probeTestnet } from "../assets/testnet-status.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const now = Date.parse("2026-10-31T09:00:00Z");
const horizon = (changes = {}) => ({
  network_passphrase: TESTNET.passphrase,
  history_latest_ledger: 4_000_000,
  history_latest_ledger_closed_at: new Date(now - 5000).toISOString(),
  ...changes,
});

test("M1: only the Stellar Testnet passphrase is accepted", () => {
  assert.equal(TESTNET.horizon, "https://horizon-testnet.stellar.org");
  assert.equal(validateHorizonRoot(horizon(), now).state, "verified");
  assert.equal(validateHorizonRoot(horizon({
    network_passphrase: "Public Global Stellar Network ; September 2015"
  }), now).state, "mismatch");
  assert.equal(validateHorizonRoot(horizon({ network_passphrase: null }), now).state, "mismatch");
});

test("M1: ledger check fails closed on stale, future and incomplete data", () => {
  assert.equal(validateHorizonRoot(horizon({
    history_latest_ledger_closed_at: new Date(now - 240_000).toISOString()
  }), now).state, "stale");
  assert.equal(validateHorizonRoot(horizon({
    history_latest_ledger_closed_at: new Date(now + 60_000).toISOString()
  }), now).state, "stale");
  assert.equal(validateHorizonRoot(horizon({ history_latest_ledger: 0 }), now).state, "unavailable");
  assert.equal(validateHorizonRoot({}, now).state, "mismatch");
  assert.equal(validateHorizonRoot(null, now).state, "unavailable");
});

test("M1: probe handles valid Testnet responses", async () => {
  const status = await probeTestnet({
    nowMs: now,
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://horizon-testnet.stellar.org/");
      assert.equal(opts.method, "GET");
      return { ok: true, json: async () => horizon() };
    },
  });
  assert.equal(status.state, "verified");
  assert.equal(status.ledger, 4_000_000);
  assert.match(status.message, /not indicate deployed exchange contracts/);
});

test("M1: probe never treats errors or wrong network as verified", async () => {
  assert.equal((await probeTestnet({
    fetchImpl: async () => { throw Error("offline"); }
  })).state, "unavailable");
  assert.equal((await probeTestnet({
    fetchImpl: async () => ({ ok: false })
  })).state, "unavailable");
  assert.equal((await probeTestnet({
    fetchImpl: async () => ({ ok: true, json: async () => horizon({
      network_passphrase: "Public Global Stellar Network ; September 2015"
    }) })
  })).state, "mismatch");
});

test("M1: landing, mobile menu, and terminal navigation use real local resources", async () => {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const css = await readFile(resolve(root, "assets/site.css"), "utf8");
  const terminal = await readFile(resolve(root, "app/index.html"), "utf8");
  assert.match(html, /id="main-content"/);
  assert.match(html, /id="primaryNavigation"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="networkCheckState"/);
  assert.match(html, /role="status"/);
  assert.match(html, /STELLAR TESTNET/);
  assert.match(html, /LAUNCH TESTNET TERMINAL/);
  assert.match(html, /href="\.\/app\/"/);
  assert.match(html, /href="\.\/docs\/milestones\.md"/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(terminal, /EXECUTION UNAVAILABLE ON TESTNET/);
  for (const path of ["assets/landing.mjs", "assets/testnet-status.mjs", "assets/icon.svg", "app/index.html", "app/terminal.js", "docs/milestones.md"]) {
    await access(resolve(root, path));
  }
});

test("M1: landing links and terminal are strictly no-deposit/no-trade demos", async () => {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const terminal = await readFile(resolve(root, "app/index.html"), "utf8");
  assert.match(html, /TRADING, BORROWING, MARGIN TRANSFERS AND CONTRACT DEPOSITS REMAIN DISABLED/);
  assert.match(terminal, /disabled>EXECUTION UNAVAILABLE ON TESTNET/);
  assert.match(terminal, /<button disabled>DEPOSIT<\/button>/);
  assert.match(terminal, /<button disabled>WITHDRAW<\/button>/);
});
