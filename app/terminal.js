(() => {
  "use strict";
  const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
  const HORIZON = "https://horizon-testnet.stellar.org";
  const $ = (id) => document.getElementById(id);
  let publicAddress = null;
  let balances = [];
  let activePortfolioTab = "Balances";

  const notice = (message) => {
    const element = $("toast");
    element.textContent = message;
    element.classList.remove("hidden");
    clearTimeout(notice.timeout);
    notice.timeout = setTimeout(() => element.classList.add("hidden"), 6500);
  };
  const walletLabel = () => publicAddress
    ? publicAddress.slice(0, 5) + "…" + publicAddress.slice(-5) : "CONNECT WALLET";
  document.querySelectorAll("[data-portfolio-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      activePortfolioTab = button.dataset.portfolioTab;
      document.querySelectorAll("[data-portfolio-tab]").forEach((b) => b.classList.toggle("active", b === button));
      renderPortfolio();
    }));

  function renderPortfolio() {
    const root = $("portfolioBody");
    root.replaceChildren();
    const heading = document.createElement("strong");
    const paragraph = document.createElement("p");
    if (activePortfolioTab !== "Balances") {
      heading.textContent = activePortfolioTab.toUpperCase() + " — NOT DEPLOYED";
      paragraph.textContent = "This feature requires verified testnet exchange contracts and canonical indexer data. Account-wallet balances are not trading balances.";
      root.append(heading, paragraph);
      return;
    }
    if (!publicAddress) {
      const icon = document.createElement("span");
      icon.className = "empty-icon";
      icon.textContent = "◎";
      heading.textContent = "CONNECT A TESTNET WALLET";
      paragraph.textContent = "Authorise Freighter to show your real Stellar Testnet asset balances.";
      root.append(icon, heading, paragraph);
      return;
    }
    if (!balances.length) {
      heading.textContent = "NO VERIFIED BALANCES AVAILABLE";
      paragraph.textContent = "Your account may be unfunded, or Horizon may be temporarily unavailable.";
      root.append(heading, paragraph);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "balance-grid";
    ["ASSET", "WALLET BALANCE", "ISSUER"].forEach((column) => {
      const cell = document.createElement("div"); cell.className = "balance-head"; cell.textContent = column; grid.append(cell);
    });
    balances.forEach((b) => {
      const entries = [b.asset_type === "native" ? "XLM" : b.asset_code || "Unknown", b.balance, b.asset_type === "native" ? "NATIVE" : (b.asset_issuer || "—").slice(0, 5) + "…"];
      entries.forEach((entry) => { const cell = document.createElement("div"); cell.textContent = entry; grid.append(cell); });
    });
    root.append(grid);
  }

  async function loadBalance() {
    if (!publicAddress) return;
    const queried = publicAddress;
    try {
      const response = await fetch(HORIZON + "/accounts/" + encodeURIComponent(queried), { cache: "no-store" });
      if (queried !== publicAddress) return;
      if (response.status === 404) {
        balances = [];
        $("accountAddress").textContent = queried.slice(0, 10) + "…" + queried.slice(-7) + " (unfunded)";
        renderPortfolio();
        notice("This testnet account is not funded. Use the Friendbot faucet to activate it.");
        return;
      }
      if (!response.ok) throw new Error("Horizon returned HTTP " + response.status);
      const data = await response.json();
      if (queried !== publicAddress) return;
      balances = Array.isArray(data.balances) ? data.balances : [];
      renderPortfolio();
      notice("Fetched real Stellar Testnet wallet balances.");
    } catch (e) {
      balances = [];
      renderPortfolio();
      notice("Could not fetch balance: " + String(e.message || e));
    }
  }

  async function connect() {
    if (publicAddress) {
      publicAddress = null;
      balances = [];
      $("walletButton").textContent = "CONNECT WALLET";
      $("accountAddress").textContent = "No wallet connected";
      $("faucetButton").disabled = true;
      renderPortfolio();
      notice("Wallet disconnected from this interface. Freighter permissions can be managed in your wallet.");
      return;
    }
    const api = window.freighterApi;
    if (!api?.isConnected || !api?.requestAccess) {
      notice("Freighter API unavailable. Install Freighter from freighter.app, or check whether the wallet library loaded.");
      return;
    }
    try {
      const installed = await api.isConnected();
      if (!installed.isConnected) {
        notice("Freighter extension was not detected. Install it from freighter.app.");
        return;
      }
      const access = await api.requestAccess();
      if (access.error || !access.address) throw new Error(access.error?.message || "Wallet access denied");
      if (typeof api.getNetwork !== "function") throw new Error("Freighter network verification is unavailable");
      const net = await api.getNetwork();
      if (net.error || net.network !== "TESTNET" || net.networkPassphrase !== NETWORK_PASSPHRASE) {
        throw new Error("Switch Freighter to Stellar TESTNET before connecting. Mainnet is blocked.");
      }
      const address = access.address;
      if (!/^G[A-Z2-7]{55}$/.test(address)) throw new Error("Wallet returned an invalid Stellar account address");
      publicAddress = address;
      $("walletButton").textContent = walletLabel() + " ×";
      $("accountAddress").textContent = address.slice(0, 12) + "…" + address.slice(-10);
      $("faucetButton").disabled = false;
      await loadBalance();
    } catch (e) { notice("Wallet connection failed: " + String(e.message || e)); }
  }
  $("walletButton").addEventListener("click", connect);
  $("faucetButton").addEventListener("click", async () => {
    if (!publicAddress) return;
    const account = publicAddress;
    $("faucetButton").disabled = true;
    try {
      const result = await fetch("https://friendbot.stellar.org/?addr=" + encodeURIComponent(account));
      if (!result.ok) throw new Error("Friendbot HTTP " + result.status);
      notice("Friendbot submitted testnet funding. Refreshing wallet balance...");
      await loadBalance();
    } catch (e) {
      notice("Friendbot funding failed: " + String(e.message || e));
    } finally {
      if (account === publicAddress) $("faucetButton").disabled = false;
    }
  });

  async function updateLedger() {
    try {
      const response = await fetch(HORIZON + "/", { cache: "no-store" });
      if (!response.ok) throw new Error("Horizon HTTP error");
      const data = await response.json();
      if (data.network_passphrase !== NETWORK_PASSPHRASE) throw new Error("Wrong Stellar network");
      const ledger = Number(data.history_latest_ledger);
      const closeMs = Date.parse(data.history_latest_ledger_closed_at);
      if (!Number.isSafeInteger(ledger) || ledger < 1 || !Number.isFinite(closeMs) ||
          Date.now()-closeMs > 120000 || closeMs-Date.now() > 15000) throw new Error("Stale or missing ledger");
      $("ledgerValue").textContent = "#" + ledger.toLocaleString("en-GB");
      $("networkStatus").textContent = "STELLAR TESTNET VERIFIED (READ ONLY)";
    } catch {
      $("ledgerValue").textContent = "UNAVAILABLE";
      $("networkStatus").textContent = "STELLAR TESTNET UNVERIFIED";
    }
  }
  function updateClock() { $("clock").textContent = new Date().toISOString().slice(11, 19); }
  renderPortfolio();
  updateClock();
  updateLedger();
  setInterval(updateClock, 1000);
  setInterval(updateLedger, 30000);
})();