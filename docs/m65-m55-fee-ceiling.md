# M65 — Read-only Testnet simulation fee ceiling

The M55 live RPC simulation job failed on 2026-11-03 with `M44 XDR: transaction fee exceeds configured ceiling` ([exact GitHub Actions evidence](https://github.com/mushee-io/Hoxo-SS/actions/runs/41557065441)). This is a refusal to accept a higher resource fee, **not** evidence that a spot transaction executed or failed on-chain.

The read-only M55 verification script now allows up to **10,000,000 stroops (1 XLM)** of assembled simulation fees, which is the verifier's existing absolute ceiling. This affects only the unsigned, non-broadcasting CI simulation. Browser wallet approval and execution paths retain the stricter default **1,000,000 stroops (0.1 XLM)**. Do not silently adopt the larger ceiling for any signed trade; require separate user review of exact fees and re-simulation if the user-controlled path is ever changed.

Run `node --test tests/m65-m55-fee-boundary.test.mjs` and `npm run m55:simulate:testnet` on the branch. Passing simulation does not satisfy signed BUY/SELL acceptance, and a failure above the hard ceiling must remain a failure. Do not sign, broadcast, unpause, merge to main or deploy to Vercel from this draft.

## Follow-up 2026-11-03 02:02 UTC

[PR #52 CI run 41563503921](https://github.com/mushee-io/Hoxo-SS/actions/runs/41563503921) still failed the live M55 simulation despite the 10,000,000-stroop simulation-only ceiling. Eight other jobs passed. The failure remains fail-closed; do **not** increase the browser signing ceiling to chase this CI result. The verifier now includes the observed assembled fee and configured limit in the exception so the next CI run can distinguish an unexpectedly high network resource fee from a configuration mistake. This is a diagnostic improvement, not evidence of successful simulation, trading or deployment.
