# M22 — Security audit readiness, deterministic fuzzing and chaos drills

**Status: automated audit-readiness/chaos foundation implemented. Independent audit NOT performed. No customer-fund or public beta authorisation.** All seven Hoxo contract roles remain planned/unverified in the Stellar Testnet registry. M21's real-wallet financial acceptance remains blocked.

## What this milestone actually tests

**Rust deterministic property tests** (source: `crates/risk-math/tests/m22_properties.rs`) exercise a reproducible seeded corpus of 2,500 multi-product portfolio cases plus 512 stale/future/overflow cases and 512 adverse price-shock cases. Properties include:

- More collateral cannot worsen equity/available margin or health classification when exposure is unchanged.
- More debt cannot improve equity or health, and initial margin requirements cannot fall.
- Additional order reservations consume margin without minting equity; unpaid funding reduces equity.
- Withdrawal previews cannot improve equity and must never mutate original positions.
- Loss-making long/short price shocks reduce equity; invalid/stale/future oracle values and overflow fail closed.
- Deterministic seeds make a failing case reproducible; **this is property-based testing of a reference risk model, not an independent formal proof**.

**Soroban M15 deterministic state-transition stress** (source: `contracts/unified-margin/src/tests.rs`) exercises 64 seeded deposit-backed spot/perp/lending reservations in the test environment, partial settlement, cancellation/release, pause/unpause, replay denial, per-wallet claim conservation, exact token-vault solvency, and final zero-liability withdrawals. This uses a mock permissive risk authority and is **not connected to live M9/M11/M12 adapters** or authenticated real Testnet collateral.

**JavaScript economic stress/mutation tests** (source: `tests/m22-risk-stress.test.mjs`) exercise 2,000 account/debt/withdrawal scenarios, 1,000 perp shock scenarios and 1,000 oracle mutation scenarios. Candidate prices must never produce trade authorisation, even when samples are mathematically plausible.

**Storage and infrastructure chaos** (source: `tests/m22-chaos.test.mjs`) injects disk exhaustion before a checkpoint append, truncates/checksum-tampers checkpoint history, breaks RPC event ingestion, changes a ledger hash during a scan, trips the oracle operator circuit breaker, stresses the bounded request limiter, and refuses write-capable RPC methods in M21. All tests are isolated and make **zero real transfers, spot settlements, borrowings or perpetual trades**.

## Explicit M22 audit/release blockers

The operator CLI prints a structured seven-item open-finding register. **Critical**: independent Testnet deployment/code-hash verification; approved on-chain risk/oracle; atomic cross-product M15 integration; independent security audit and remediation sign-off. **High**: real-wallet financial proof, recovery drills and production indexer/rate infrastructure.

The gate cannot be satisfied with self-declared `audited:true` metadata or passing unit tests. This is intentional: a source repository, a CI run, a signed match intent or a Testnet RPC claim cannot unilaterally confer third-party audit approval.

Run:

    npm run m22:readiness

The following **must fail** until an independent release process exists:

    npm run m22:readiness -- --require-clearance

CI checks only that the **blocked status is returned correctly**; it never conflates an expected blocked gate with a passed security audit.

## Independent audit scope to commission

| Scope | Minimum external review |
| --- | --- |
| M6/M15 vault and unified collateral | Actor ownership/allowlists, reserve/claims conservation, re-entrancy, storage TTL, pause-and-withdraw semantics, adapter permissions and cross-product atomicity |
| M9 settlement | Exact two-sided Soroban auth, token issuer/decimal checks, slippage/limit bounds, matching receipts, replay, expiration, failed transfer atomic rollback |
| M10/M11 lending | Debt-share precision, rate accrual and elapsed-time bounds, supply caps, utilization, liquidation readiness, debt socialization and bad debt |
| M12–M14 perpetuals | Bilateral auth, funding, oracle latency, liquidation threshold/partial coverage, fees, keeper authority, insurance insolvency and queue/griefing |
| M5/M7/M16 oracles and risk | Authenticated on-chain oracle freshness/deviation, economic attacks, position netting, funding interest duplication, state tampering and checked arithmetic |
| M19–M21 off-chain | Signed commands, durable journal, DoS, replay/reorg handling, RPC trust, Testnet wallet receipt checks, operational secrets/keys and privilege boundaries |

## Manual Testnet chaos acceptance (not yet executed)

After independently verified deployments and reviewed valueless assets, run these with four separate funded Testnet wallets and independent observers:

1. Exhaust RPC, disconnect Horizon, replay a stale ledger, and introduce a Testnet reset. Prove **no new credit/debit** can be inferred while unverified and that recovery requires reconciliation.
2. Freeze/warp oracle readings and deliberately diverge sources. Confirm **on-chain** liquidation, borrow and new-position entry reject stale/invalid prices without blocking authorized withdrawals.
3. Simulate keeper failure during undercollateralisation. Quantify debt/insurance exposure and enforce real collateral/fee/claim conservation.
4. Inject a pause during deposits, spot fills, lending and perp funding; prove contract-level admin guards and authorized recovery rather than relying on M20's local-process flags.
5. Test interrupted deposit/repay/close, repeated transaction hashes, failed auth entries, storage TTL archival/restore and wallet disconnection. Independently reconcile before/after on-chain balances and receipts.
6. Test fee ceilings, gas/griefing, precision/dust, extreme utilization, adverse price shocks and market concentration using contract-client fuzzing and multi-wallet adversarial transactions.

**Evidence required per scenario:** reproducible command/environment, approved contract code hash and authority, Testnet network/ledger, transaction hash, funded signer identities (public addresses only), pre/post chain state, independent observer reconciliation, pass/fail criteria, issue and remediation owner, reviewer signature and regression test. Never store signing secrets in CI, GitHub issues or documentation.

## Third-party audit exit conditions

- Scope and source commit locked, contract WASM hashes independently checked, threat model reviewed, coverage/assumptions published and all critical/high vulnerabilities fixed and retested.
- All approved canonical contracts wired (M15 with M6/M9/M11/M12), exact real-wallet M21 lifecycle receipts and economic-state invariants demonstrated, oracle/risk authority approved.
- Emergency pause and storage recovery drills exercised **on-chain**, not just HTTP; keeper and oracle outage response independently reviewed.
- Independent qualified auditor signs the report and findings; unresolved risk formally escalated and accepted by the appropriate authorized governance **without silently bypassing the gate**.
- Mainnet launch is a **separate M24 decision**; M22 passing in the future would not automatically enable it.

## Commands

    npm run test:m22
    npm test
    cargo test -p hoxo-risk-math --all-targets
    npm run m22:readiness
    npm run check:readiness

This milestone does not claim a deployed protocol, successful real trading, audited contract safety or reconstructed wallet PnL. **M22 independent review is still outstanding, and M23 beta remains blocked.**
