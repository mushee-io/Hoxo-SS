# M65 — Read-only Testnet simulation fee ceiling

The M55 live RPC simulation job failed on 2026-11-03 with `M44 XDR: transaction fee exceeds configured ceiling` ([exact GitHub Actions evidence](https://github.com/mushee-io/Hoxo-SS/actions/runs/41557065441)). This is a refusal to accept a higher resource fee, **not** evidence that a spot transaction executed or failed on-chain.

The read-only M55 verification script now allows up to **10,000,000 stroops (1 XLM)** of assembled simulation fees, which is the verifier's existing absolute ceiling. This affects only the unsigned, non-broadcasting CI simulation. Browser wallet approval and execution paths retain the stricter default **1,000,000 stroops (0.1 XLM)**. Do not silently adopt the larger ceiling for any signed trade; require separate user review of exact fees and re-simulation if the user-controlled path is ever changed.

Run `node --test tests/m65-m55-fee-boundary.test.mjs` and `npm run m55:simulate:testnet` on the branch. Passing simulation does not satisfy signed BUY/SELL acceptance, and a failure above the hard ceiling must remain a failure. Do not sign, broadcast, unpause, merge to main or deploy to Vercel from this draft.

## Follow-up 2026-11-03 02:02 UTC

[PR #52 CI run 41563503921](https://github.com/mushee-io/Hoxo-SS/actions/runs/41563503921) still failed the live M55 simulation despite the 10,000,000-stroop simulation-only ceiling. Eight other jobs passed. The failure remains fail-closed; do **not** increase the browser signing ceiling to chase this CI result. The verifier now includes the observed assembled fee and configured limit in the exception so the next CI run can distinguish an unexpectedly high network resource fee from a configuration mistake. This is a diagnostic improvement, not evidence of successful simulation, trading or deployment.

## Independently observed fee, 2026-11-03 02:58 UTC

[Exact-head CI run 41569303135](https://github.com/mushee-io/Hoxo-SS/actions/runs/41569303135) failed the read-only M55 simulation with **21,941,726 stroops (2.1941726 Testnet XLM)**, exceeding the simulation-only 10,000,000-stroop cap. Eight other jobs passed. This is a real RPC-assembled resource-fee observation, **not** a signed fee, fill, transfer or proof of public trading. The 1,000,000-stroop browser signing ceiling remains unchanged. M65 now explicitly classifies this over-cap case in regression tests and refuses unsafe/invalid limits. Investigate Soroban resource usage and contract auth footprint before any reviewed fee-policy change; do not automatically increase limits.

## Exact-head verification — 2026-11-03 04:56 UTC

[PR #52 run 41580971271](https://github.com/mushee-io/Hoxo-SS/actions/runs/41580971271) tested head `e8f3aee5e1edd86de6e86800e65a9bd81ad4e87e`: **8 jobs passed, M55 live unsigned simulation failed**. The RPC-assembled fee was **22,043,525 stroops (2.2043525 Testnet XLM)**; the reported `minResourceFee` was **22,042,525 stroops**, leaving exactly **1,000 stroops** of transaction inclusion fee. The configured read-only ceiling was **10,000,000 stroops**. RPC returned no `cost.cpuInsns` or `cost.memBytes` in this response (`unknown`), so do not infer CPU/memory from the fee alone. The code refused to sign or broadcast. This confirms diagnostics worked but does **not** validate executable settlement.

### Engineering investigation before fee-policy changes

1. Preserve a reproducible read-only simulation of the exact M9 `settle` invocation and ledger height; collect Soroban transaction-data resource fields (read/write bytes, instructions, footprint entries, refundable/non-refundable fee) from assembled XDR without logging wallet secrets or auth signatures.
2. Compare M9's footprint and auth paths against the minimum bilateral XLM/USDC operation; profile deployed WASM matching the independently verified hash, not an unverified local rebuild.
3. Check whether footprint entries, rent extension or auth-related writes dominate resource fees. Changes to source do not alter the already deployed contract.
4. Keep **0.1 XLM browser** and **1 XLM CI simulation** fee ceilings and security review gates unchanged. A larger fee or contract upgrade requires a separate reviewed decision; CI success is not consent to spend assets.

No signed Hoxo BUY/SELL receipt or public matching liquidity was established.

## M76 — fail-closed fee policy before RPC (2026-11-03)

The read-only simulation now validates its configured fee ceiling before contacting the Stellar Testnet RPC. Invalid, fractional, negative, under-100-stroop or above-10,000,000-stroop limits abort before ledger reads, account reads or simulation. This prevents misconfigured automation from performing an RPC simulation under an invalid policy; it does not increase the existing 1 XLM simulation-only ceiling or the 0.1 XLM browser signing ceiling. Regression: `node --test tests/m76-fee-policy-preflight.test.mjs` (also included in `npm test`). The open PR must still pass exact-head CI and independent review; a successful test is not an on-chain trade receipt.
