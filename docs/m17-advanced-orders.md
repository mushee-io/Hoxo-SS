# M17 — Advanced Order Controls, Signed Sandbox Triggers and Audit Transitions

**State:** Off-chain Stellar **Testnet reference sandbox** source, not deployed trading. M17 extends the existing M8 signed order matcher and its hash-chained, fsync-persisted journal. **No Hoxo contracts have deployed; M5 oracle and M7/M16 canonical risk enforcement are missing.** All matching fills remain `simulated:true`, `settlement:"NOT_SETTLED"`, `executionPermitted:false`. Nothing sends money or genuine Stellar orders.

## Implemented in the existing engine

- **Limit orders:** signed `advanced_place` fields with `orderType:"limit"`, exact up-to-seven-decimal price and quantity, fixed market, expiry and owner-specific nonce. Uses existing M8 deterministic best-price/FIFO priority, owner authentication, self-trade prevention and replay IDs. Unfilled limit remainder rests; M8's signed atomic replace remains supported for older orders.
- **Protected market orders:** `orderType:"market"` carries a mandatory explicit user `protectionPriceE7`: maximum buy price or minimum sell price. It immediately consumes eligible book liquidity at *resting maker* prices and **never posts unfilled remainder** (IOC). No unbounded market purchase or invented liquidity. Partially filled and unfilled IOC states are tracked separately.
- **Reduce-only:** optional `reduceOnly:true` only on reference perp markets; both order creation and matching enforce direction/size against locally simulated signed positions. Outstanding reduce-only maker/pending orders consume an internal reservation of simulated reduction capacity. Matching never turns an intended reduction into a larger or reversed **simulated** position. These positions are derived only from local M8/M17 **unsettled fills**. **They are not account truth, cannot be used as real margin, and do not secure any actual exchange execution.**
- **Stop-loss / take-profit:** `stop_loss_market`, `stop_loss_limit`, `take_profit_market`, `take_profit_limit` are pending off-book, always require reduce-only simulated perp exposure and exact trigger/price guard. Sell stop triggers at or below trigger; sell take-profit at or above. Buy stop triggers at or above; buy take-profit at or below. A triggered limit can rest; a triggered protected market order remains IOC. An expired conditional cannot trigger or reuse its ID.
- **Price authenticity limitation:** conditional order activation uses a specially signed `sandbox_tick`, verified against one explicitly configured `HOXO_M17_SANDBOX_TICK_SIGNER` public Stellar G-address. Tick timestamp must be recent (≤120 seconds), non-future, strictly increasing per market and on a perp reference symbol. Ticks declare `SIGNED_SANDBOX_OPERATOR_NOT_M5_ORACLE` and **are not evidence of a canonical on-chain mark/index, oracle, funding tick or ledger trade**. With no configured public operator, ticks are rejected; no private keys are ever read from environment. A valid operator tick can be replayed deterministically from the durable signed command log.
- **Auditable state transitions:** M17 orders record `SUBMITTED → RESTING`, `PENDING_TRIGGER → TRIGGERED → simulated outcome`, `CANCELLED`, `EXPIRED`, `IOC_UNFILLED`, `IOC_PARTIAL` and partial/complete simulated maker fills. Every signed command is appended with a previous-record SHA-256 hash and fsync before acknowledgement; restart verifies signatures, nonce sequence and the entire hash chain. Invalid, tampered or truncated records halt the journal. Transition events include order ID, previous/new state, reason, recorded UTC epoch milliseconds, deterministic sequence and explicit non-settlement markers.

## Operator and API

Use `npm run dev:matching` to run the existing local-loopback API (no CORS write support). Optional `HOXO_M17_SANDBOX_TICK_SIGNER=G...` enables **only sandbox trigger tests**, using externally created Ed25519 signatures. The server **does not hold signing keys**. HTTP write `POST /v1/commands` still requires a valid signed intent and the `x-hoxo-sandbox-ack: UNSETTLED` header. No broadcast or settlement endpoint exists.

New **read-only** endpoints:
- `GET /v1/advanced/order?orderId=<owner:clientId>` shows live pending/resting advanced orders only.
- `GET /v1/advanced/history?orderId=<owner:clientId>` returns signed-journal-derived order lifecycle transitions.
- `GET /v1/advanced/position?owner=<G-address>&marketId=xlm-usdc-perp` returns **SIMULATED_MATCHES_NOT_ONCHAIN** exposure. All outputs explicitly indicate no settlement.

## Test acceptance

```sh
npm run test:advanced
npm run test:matching
npm test
npm run check:readiness
```

M17 tests use actual in-memory Ed25519 wallet signing and verify that replayed journals reproduce exactly the same pending orders, triggered limit/IOC fills, exposure and transition history. Negative scenarios cover forged signatures, wrong network, over-sized reduce-only, missing or stale operator ticks, replayed ticks, self/other owner cancellation, market price protection, unmatched IOC, expiry tombstones, and disabled HTTP broadcast endpoints. The pre-existing M8 tests must remain green.

## Remaining release blockers

1. Replace signed *sandbox* price ticks with an audited **M5 canonical on-chain oracle** with independently authenticated mark/index and historical funding.
2. Link the M8/M17 signed order intents and amendments to a real **M15 canonical collateral reservation and M16 risk controller**, as well as the M9/M12 Soroban transaction paths. M17's simulated positions are **never** valid for real reduce-only decisions.
3. Build user-facing TP/SL/OCO contingent position management with ledger-time trigger/expiry semantics, controlled keeper rights, true on-chain order execution and reorg-safe proofs. No genuine stop loss, liquidation or profit protection is provided by sandbox matching.
4. Deploy, externally audit and exercise independent signed Stellar Testnet wallets through real settlement and reconciliation. Until then real spot/perp trade buttons, custody and borrowing remain **disabled**.

**Do not advertise M17 as operational trading. It is deterministic, signed, auditable advanced-order sandbox engineering only.**

## Verified M17 CI — 31 October 2026

[GitHub Actions run 41219081680](https://github.com/mushee-io/Hoxo-SS/actions/runs/41219081680) passed all **7/7 jobs** for implementation and safety-check commit `475df3601cf241517f8ec96a2801a6dc9335d342`.

- **14/14 new M17 advanced-order tests**, including actual Ed25519 signed-operator and wallet commands, market/limit and TP/SL behavior, simulated reduce-only quantity checks, fail-closed tick validation, terminal statuses, journal replay/tamper resistance and local read-only HTTP endpoints.
- **15/15 existing M8 matching-engine tests**, proving compatibility with the original Testnet signed price/time book and hash-chain journal.
- **105/105 total JavaScript tests**; **8/8 Chromium browser tests**.
- **135/135 Rust/Soroban tests**, plus pinned official Stellar CLI WASM builds for existing M7/M9/M11/M14/M15 contracts.
- Live **read-only** Stellar Testnet RPC/Horizon connectivity and registry checks passed. These are **not** actual trading, collateral or liquidation transaction receipts.
- The `check:readiness` safety checks report **NOT_LIVE**, no approved oracle, no deployed Hoxo exchange contracts, blocked trading/custody controls and a distinct signed-sandbox-tick provenance requirement.

**M17 builds no new on-chain contract**. Therefore there is no M17 WASM file to download. Source integration and signed journal tests constitute the implemented milestone. No order from M17 has legally or technically authorized the spending of any Stellar wallet; all simulated PnL and positions remain unauthenticated local reference data.
