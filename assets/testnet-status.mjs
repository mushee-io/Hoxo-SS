/** Hoxo-SS M1 read-only Stellar Testnet network verification. Never validates exchange readiness. */
export const TESTNET = Object.freeze({
  horizon: "https://horizon-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  staleAfterMs: 120_000
});

function fail(state, message) {
  return { state, ledger: null, closeTime: null, message };
}

/** Rejects wrong networks, stale ledgers and missing proof rather than implying connectivity. */
export function validateHorizonRoot(data, nowMs = Date.now()) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return fail("unavailable", "Horizon did not provide a valid network response.");
  }
  if (data.network_passphrase !== TESTNET.passphrase) {
    return fail("mismatch", "Horizon response does not match the Stellar Testnet network passphrase.");
  }
  const ledger = Number(data.history_latest_ledger);
  const closeTime = Date.parse(data.history_latest_ledger_closed_at);
  if (!Number.isSafeInteger(ledger) || ledger < 1 || !Number.isFinite(closeTime)) {
    return fail("unavailable", "Horizon has no verifiable current ledger information.");
  }
  const ageMs = nowMs - closeTime;
  if (!Number.isFinite(nowMs) || ageMs < -15_000 || ageMs > TESTNET.staleAfterMs) {
    return fail("stale", "Stellar Testnet ledger information is stale or has an invalid timestamp.");
  }
  return {
    state: "verified",
    ledger,
    closeTime: new Date(closeTime).toISOString(),
    ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
    message: "Stellar Testnet Horizon is reachable. This does not indicate deployed exchange contracts."
  };
}

export async function probeTestnet({ fetchImpl = globalThis.fetch, nowMs, timeoutMs = 8_000 } = {}) {
  if (typeof fetchImpl !== "function") return fail("unavailable", "Browser fetch is not supported.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(TESTNET.horizon + "/", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response?.ok) return fail("unavailable", "Stellar Testnet Horizon returned an HTTP error.");
    const data = await response.json();
    return validateHorizonRoot(data, nowMs ?? Date.now());
  } catch {
    return fail("unavailable", "Cannot verify Stellar Testnet Horizon from this browser right now.");
  } finally {
    clearTimeout(timeout);
  }
}
