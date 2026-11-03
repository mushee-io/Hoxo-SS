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

## 2026-11-03 11:00 UTC — M68 independent RPC metadata fallback

Exact-head M67 [CI run 41616177620](https://github.com/mushee-io/Hoxo-SS/actions/runs/41616177620) failed the M55 unsigned simulation at 22,308,918 stroops (minimum resource fee 22,307,918); all other eight jobs passed. The assembled-envelope resource accessor still yielded `unknown` fields. M68 now attempts the RPC `transactionData` Soroban XDR directly when the assembled-envelope accessor fails, with a regression fixture for the fallback. This is diagnostic only, not a fee reduction or permission to sign. A new exact-head CI run must confirm the behavior. Keep the 10,000,000-stroop CI refusal and the 1,000,000-stroop browser signing ceiling. No transactions were broadcast.

## 2026-11-03 11:56 UTC — M69 bounded RPC shape investigation

[Exact-head M68 run 41624398644](https://github.com/mushee-io/Hoxo-SS/actions/runs/41624398644) completed with eight passing jobs and the M55 read-only simulation failing safely. The assembled fee was **22,359,602 stroops** (minimum resource fee **22,358,602**), above the 10,000,000-stroop simulation cap. All resource fields were still `unknown`, including after the M68 fallback. M69 now prints only bounded public metadata *types* and the envelope extension presence when the fee is rejected, to determine why resource extraction fails without printing ledger keys, auth, raw XDR or secrets. Regression tests verify the diagnostic cannot echo private input strings. This does not reduce the fee or enable trading; wait for exact-head CI before interpreting new output.

## 2026-11-03 12:58 UTC — M70 XDR envelope decoding correction

[Exact-head M69 run 41631688116](https://github.com/mushee-io/Hoxo-SS/actions/runs/41631688116) passed eight jobs and failed the M55 unsigned simulation safely: 22,405,842 stroops assembled, 22,404,842 minimum resource fee. The new metadata shape reported `envelope:no-switch`, confirming that `Transaction.toEnvelope()` was not exposing the expected XDR union accessors. M70 decodes the serialized transaction envelope using the official XDR parser before extracting public Soroban resource counts. This changes diagnostics only, not the transaction, the fee ceiling, signing, broadcasting, or deployment. Exact-head CI must establish whether resource fields become available; the fee remains above the 10,000,000-stroop CI cap.

## 2026-11-03 14:00 UTC — M71 exact-head failure and SDK accessor repair

[Exact-head M70 run 41640277111](https://github.com/mushee-io/Hoxo-SS/actions/runs/41640277111) completed with eight passing jobs; M55 failed safely at 22,458,677 stroops assembled (minimum resource fee 22,457,677), above the unchanged 10,000,000-stroop unsigned CI cap. Resource fields remained unknown. Source inspection found M70 calling `assembled.toXdr()`, whereas the Stellar SDK transaction exposes `toEnvelope()` and `toXDR()` (capital XDR). M71 reads the XDR envelope directly, with a regression test preventing the incorrect accessor. This is diagnostic-only; the fee root cause is still unverified and exact-head CI is pending. No signing, broadcast, deployment, merge, or fee-limit increase.
