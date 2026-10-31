# Milestone gates and acceptance

| Gate | Work | Pass condition | Status |
| --- | --- | --- | --- |
| M0 | Product charter, risk math, risk tests, CI | Risk tests pass; docs define boundaries | Implemented in this branch, CI unverified |
| M1 | Soroban vault / account registry | Signed deposits + withdrawals confirmed on Stellar testnet; no double spend | Not built |
| M2 | Oracle integration | Canonical price feeds, staleness/deviation circuit breakers, testnet verification | Not built |
| M3 | Spot routing and settlement | Real testnet token swaps and receipts, slippage enforcement | Not built |
| M4 | Lending and borrowing | Supply, interest, borrow, repay, liquidate tested with invariant properties | Not built |
| M5 | Perpetuals | Open/close/funding/settle/liquidate on testnet with real signed wallet actions | Not built |
| M6 | Unified margin integration | Collateral, debts, perps, orders checked atomically across products | Not built |
| M7 | Trading terminal | Wallet connect, balances, trading, lending and history reflect real state | Not built |
| M8 | Security and production gate | Fuzz tests, independent audit, remediation, monitoring, emergency controls | Not built |

The intended experience is a **single trading terminal**, not separate app silos. A demo, test fixture, mock or disconnected UI must not be advertised as live trading.

### Immediate next engineering work
Implement Soroban contract workspace and typed account/asset registry; authenticate users, guard asset transfers, derive shared margin state and create property-based tests. Real asset/token contract IDs, oracle operators, deployment keys and RPC configuration remain required for end-to-end deployment.
