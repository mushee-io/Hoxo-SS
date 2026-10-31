import { probeTestnet } from "./testnet-status.mjs";

const find = (id) => document.getElementById(id);
const state = find("networkCheckState");
const dot = find("networkStatusDot");
const ledger = find("testnetLedger");
const lastClose = find("testnetClose");
const detail = find("networkCheckDetail");
const refresh = find("refreshTestnet");
let lastProbeAt = 0;
let running = false;

async function refreshStatus() {
  if (running) return;
  running = true;
  state.textContent = "CHECKING...";
  dot.className = "network-status-dot";
  refresh.disabled = true;
  try {
    const result = await probeTestnet();
    lastProbeAt = Date.now();
    dot.className = "network-status-dot " + (result.state === "verified" ? "verified"
      : result.state === "stale" || result.state === "mismatch" ? "warning" : "unavailable");
    state.textContent = result.state === "verified" ? "TESTNET VERIFIED"
      : result.state === "stale" ? "TESTNET DATA STALE"
      : result.state === "mismatch" ? "WRONG NETWORK" : "STATUS UNAVAILABLE";
    ledger.textContent = result.ledger === null ? "—" : result.ledger.toLocaleString("en-GB");
    lastClose.textContent = result.closeTime === null ? "—"
      : new Date(result.closeTime).toISOString().slice(11, 19) + " UTC";
    detail.textContent = result.message;
  } finally {
    running = false;
    refresh.disabled = false;
  }
}
refresh.addEventListener("click", refreshStatus);
refreshStatus();
setInterval(() => { if (!document.hidden) refreshStatus(); }, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastProbeAt > 60_000) refreshStatus();
});

const toggle = find("menuToggle");
const nav = find("primaryNavigation");
const closeMenu = () => {
  nav.classList.remove("is-open");
  toggle.setAttribute("aria-expanded", "false");
};
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
});
nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
