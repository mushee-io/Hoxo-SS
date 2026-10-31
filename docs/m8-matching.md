# M8 — Signed price/time matching engine (Stellar Testnet sandbox)

**Scope:** A durable, deterministic order-book **matching engine** that runs separately from the Stellar chain. It is a real operational matching service, but **not an exchange**, and every match is **unsettled**. Nothing transfers tokens or creates an authenticated on-chain collateral reservation.

## Implemented

- **Price/time FIFO**: highest bid/lowest offer wins; oldest resting order at equal price takes priority; maker's resting price is used for matches.
- **Limit orders only**: testnet reference instrument IDs from the existing UI. No claim that the instrument has a genuine token issuer, price oracle, executable order book or deployed settlement contract.
- **Maker/taker fills with partial fills**: amounts and prices use integer 10⁷ units, never binary floating-point. Match results carry `simulated:true`, `settlement:"NOT_SETTLED"` and `executionPermitted:false`.
- **Self-trade prevention**: reject the entire command if matching would cross the same account, even after possible third-party fills.
- **Signed authentication**: signed command payloads use Stellar Testnet's exact network passphrase, domain-separated UTF-8 payload, classic Stellar G-account checksum and cryptographic Ed25519 verification. A command may be submitted only with a valid 64-byte signature for its stated owner; there is no secret-key request and no key material stored on disk.
- **Replay protection**: strict increasing per-account nonces, globally unique per-account client order IDs, explicit order expiry (max 7 days), owner-only cancellation, same-market/same-side atomic replace with fresh queue priority.
- **Durability**: one command per append-only JSONL record, hash-linked to the previous record, `fsync` before acknowledgement, deterministic replay, exclusive `.lock` file. Altered/incomplete journals refuse startup rather than silently dropping data; write failures halt matching.
- **Loopback API**: `127.0.0.1:8788`, default; read-only `/health`, `/v1/book`, `/v1/order`, `/v1/fills`, and signed `POST /v1/commands`. The POST route requires an explicit `x-hoxo-sandbox-ack: UNSETTLED` header and does not accept browser-origin requests.
- **Capacity bounds**: maximum 5,000 resting orders per process, 100,000 accumulated simulated fills, 16KB command body, capped request rate. This is a developer/testnet prototype, not a scale benchmark.
  
## Run

Requires Node.js >=20; no new npm dependencies.

```sh
npm test
npm run test:matching
npm run dev:matching
curl http://127.0.0.1:8788/health
curl 'http://127.0.0.1:8788/v1/book?marketId=xlm-usdc-spot'
```

By default the journal is created at `.data/hoxo-m8-testnet-sandbox.jsonl`. Override `HOXO_M8_PORT` and `HOXO_M8_JOURNAL` as needed. Never share the journal lock between processes; investigate partial records before manual recovery.

### Authenticated command wire protocol

The caller signs the exact `canonicalPayload(command)` UTF-8 bytes with the **Ed25519 private key corresponding to the Stellar G account**. The API never obtains that key. Example command shape (replace account and values with your own):

```json
{
  "type": "place",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "owner": "G<VALID_STELLAR_STRKEY>",
  "nonce": 1,
  "clientOrderId": "my-limit-1",
  "marketId": "xlm-usdc-spot",
  "side": "buy",
  "priceE7": "0.15",
  "quantityE7": "10",
  "expiresAtMs": 1800000600000
}
```

A signed request body is `{"command": <above>, "signature": "<64-BYTE-BASE64URL-SIGNATURE>"}`. See `matching/auth.mjs` for canonical field ordering and exact protocol bytes. `cancel` uses `orderId`; `replace` uses the old `orderId` plus a fresh `clientOrderId` and original market/side. These are **off-chain order intent signatures**, not Stellar Soroban transaction authorizations. The Freighter UI does not yet offer a verified compatible signing path; no user-facing order submission is enabled.

## Security / known gaps

1. **Not settled**: M9 must define signed Stellar settlement transactions, match replay protection on-chain, fees and slippage constraints, and an atomic finality policy.
2. **No collateral checks**: M5 price feeds, M6 vault balances and M7 smart-contract risk enforcement must be independently verified before enabling real orders or order reservations. Those milestones **are not committed as live contracts** and no deployment evidence exists.
3. **No remote multi-tenant access**: this API intentionally binds loopback; no TLS, external connectivity, production DoS protection, HSM, wallet signature integration or multi-node leader election.
4. **No authoritative public order book**: only signed sandbox intents can populate these books. They are not Stellar DEX offers, official HOXO prices, live exchange liquidity or trading volume. The existing trading terminal's real execution controls remain disabled.
5. **Operations**: single-writer journal is durable but not fully replicated. Stale lock after a crash must be investigated; old records and expiries must be retained for audit. Crash injection, process supervision, backup/restore and order reservation accounting are future hardening.
6. **Domain separation**: signatures are Testnet-specific and versioned. Dedicated deployment IDs should be added before any remote multi-environment instance could accept orders.
7. **No deployment claim**: CI validates code and local API, not any hosted exchange or Stellar transaction.

## Acceptance criteria

- `npm run test:matching` verifies price/time, FIFO, partial fills, cancellation, replacement, signature ownership, owner nonces, self-trade rejection, expiries, replay and hash tamper detection.
- The HTTP smoke test proves requests without appropriate signatures or sandbox acknowledgement are rejected.
- GitHub Actions test suite passes while preserving the pre-existing network and browser jobs.
- A genuine Stellar Testnet exchange launch requires M5–M7 and M9–M14 on-chain integration and separate audited deployment.
