# M72 — Stellar Testnet Soroban fee diagnosis (read-only)

On 2026-11-03, [exact-head PR #52 CI run 41649906845](https://github.com/mushee-io/Hoxo-SS/actions/runs/41649906845) passed 8 of 9 jobs. The M55 live unsigned BUY/SELL simulation job refused the first simulated settlement at **22,513,949 stroops** (minimum resource fee **22,512,949 stroops**) versus the unchanged **10,000,000-stroop** read-only CI ceiling. The prior metadata output was `unknown` for all resource counts because the installed Stellar SDK's `toEnvelope()` result did not provide the expected XDR union accessors.

M72 decodes `assembled.toXdr()` as a typed `xdr.TransactionEnvelope` before extracting public Soroban resource counters, with a guarded fallback to the RPC transaction-data object. The regression tests exercise a plain-object envelope and absent metadata. Neither the CI fee ceiling nor the stricter wallet signing ceiling is increased. Unknown values remain unknown, never zero.

**Next acceptance:** inspect exact-head M72 CI's bounded resource counters. Determine whether the unexpectedly large resource fee is attributable to refundable rent, ledger footprint, contract behavior or RPC fee policy. Do not bypass the fee refusal or broadcast a transaction to investigate. M9 signed BUY/SELL receipts remain unverified; perp execution remains gated on independent deployment, oracle, margin, risk and liquidation checks. No production deployment, contract unpause, signature or on-chain transaction is authorized by this diagnostic change.

## M73 — 2026-11-03 15:03 UTC exact-head evidence

[CI run 41659825705](https://github.com/mushee-io/Hoxo-SS/actions/runs/41659825705) again passed 8/9 jobs. The unsigned M55 simulation refused **22,565,708 stroops** (minimum resource fee **22,564,708**) versus the 10,000,000-stroop diagnostic ceiling. Resource counters remained unknown, and the RPC supplied `transactionDataKind: object`, `minResourceFeeKind: base64-string`. This is not a confirmed SDK decoder or contract defect, and the fee cannot safely be interpreted as a normal transaction cost without further investigation.

M73 reports only a fixed allowlist of available methods on the returned transaction-data object (`toXDR`, `toXdr`, `resources`, `resourceFee`), never raw XDR, ledger keys, authorization entries or signatures. Its regression test asserts that sensitive-looking payloads are excluded. Inspect the next exact-head CI log to determine which public resource decoding path the SDK supports. Keep the fee ceiling unchanged and do not sign, broadcast or count any trade.
