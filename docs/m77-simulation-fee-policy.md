# M77 — Canonical unsigned simulation fee policy

This change fixes a JavaScript regular-expression escape error in the M45 unsigned Testnet simulation fee guard. A literal double backslash incorrectly rejected canonical decimal-string fee ceilings, even though bigint and safe-integer inputs worked. The fee guard now accepts only nonnegative canonical decimal strings (`100`, `1000000`, `10000000`), safe integer numbers or bigint, within 100–10,000,000 stroops. It refuses leading zeros, exponents, whitespace, fractional values, implicit coercion, and values above the simulation ceiling before any RPC work.

Run `node --test tests/m77-fee-policy-decimal.test.mjs` and the complete branch CI. This is an input-validation fix only. It **does not** solve the independently observed ~2.2 XLM resource-fee overage, authorize a larger fee, change the browser signer ceiling (0.1 XLM), or demonstrate a signed settlement. Keep PR #52 draft until exact-head CI and independent review pass. Do not merge, deploy, sign or broadcast from this change.


## M80 — malformed ceiling hardening (2026-11-03)

The offline M44 source-envelope review now classifies the exact typed fee policy before formatting refusal diagnostics. A malformed caller-provided ceiling (including null, boolean, array, object, negative or unsafe number) returns a stable fail-closed `invalid transaction fee ceiling` error rather than invoking `BigInt()` on untrusted data while building the message. The separate fee classifier and regression tests cover these cases. This does not raise the 0.1 XLM browser-signing ceiling or the 1 XLM read-only simulation ceiling, and provides no permission to sign, broadcast or claim a fill. Verify exact-head CI before merging this draft.

## M82 — bounded RPC diagnostic regression (2026-11-04)

The M69 diagnostic now reports an explicit fixed allowlist of available transaction-data methods. The existing M69 test previously expected an older object shape without `transactionDataMethods`; M82 aligns that assertion with the implemented shape and adds a separate regression ensuring that sensitive SDK properties, method return values, and thrown exception text never appear in the public diagnostic output. This is a test-only hardening change; it does not establish that the 2.2 XLM resource fee is correct, reduce it, raise either fee ceiling, or authorize signing. Run `node --test tests/m65-resource-diagnostics.test.mjs` and verify exact-head GitHub CI before review or merge.
