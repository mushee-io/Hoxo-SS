# M66 — Soroban M9 fee-footprint investigation (Testnet only)

## Evidence and status

At 2026-11-03 04:56 UTC, [GitHub Actions run 41580971271](https://github.com/mushee-io/Hoxo-SS/actions/runs/41580971271) reported a successful RPC simulation but rejected the assembled fee: 22,043,525 stroops (minimum resource fee 22,042,525). This exceeds the 10,000,000-stroop read-only CI ceiling. Eight other CI jobs passed. **No signing or broadcast occurred.**

The next run of `npm run m55:simulate:testnet` on this branch emits bounded resource diagnostics on a fee refusal: Soroban transaction-data instruction budget, read/write bytes, footprint entry counts, and resource fee, when available from assembled XDR. This does not print raw ledger keys, authorization entries, wallet secrets or XDR. It remains a failed test above the ceiling.

Compare the measurements against independently verified M9 WASM and the exact two-party settlement path. A large footprint, storage rent or authorization-related writes may be contributing, but none is established as the cause yet. Do not infer CPU/memory consumption from the RPC fee.

## Acceptance boundaries

- Browser signing remains limited to 1,000,000 stroops (0.1 XLM); unsigned CI simulation remains limited to 10,000,000 stroops (1 XLM).
- Never increase either ceiling merely to make CI pass.
- Any contract change requires deployment, independently verified WASM hash and renewed security review; changing local source does not change the deployed M9.
- Signed BUY and SELL receipts, genuine distinct-party settlement, and verified balances remain required before reporting volume. Perpetual execution remains disabled until deployment, oracle, solvency and liquidation gates pass.
- This branch is draft-only. No merge, Vercel promotion, signing or transaction submission is authorized by this investigation.

## 2026-11-03 09:00 UTC — canonical envelope diagnostic patch

The SDK assembled transaction does not reliably expose `sorobanData` as a direct property. The M66 diagnostic now reads `assembled.toEnvelope().v1().tx().ext().sorobanData()`, extracting numeric instruction/read/write budgets, read-only/read-write footprint counts, and resource fee. Regression tests cover successful extraction and safe `unknown` fallback. The diagnostic deliberately never serializes keys, auth entries, or the transaction envelope.

This patch does **not** establish the root cause or reduce resource fees. CI must verify the exact new commit and rerun the live read-only M55 simulation. The 1 XLM CI and 0.1 XLM signing limits remain unchanged. No production release or signing is authorized.

## 2026-11-03 10:00 UTC — M67 fail-safe partial diagnostics

The exact-head M66 GitHub Actions run 41608226109 failed only the M55 live simulation step: fee 22,258,090 stroops, minimum resource fee 22,257,090, above the 10,000,000-stroop CI cap. The resource inspector printed all `unknown`, so fee root cause remains undetermined. M67 reads each numeric XDR field independently, supports either `diskReadBytes()` or `readBytes()`, and retains footprint counts and resource fee when one SDK accessor is absent. A regression fixture covers that partial-failure case. Re-run exact-head CI to collect the next live measurements; do not relax the cap or enable signing/broadcast.
