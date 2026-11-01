# M34 — Cross-product settlement evidence gate

This module provides a **non-authorizing diagnostic checklist** for the M11 lending / M12 liquidation / M15 shared-collateral integration. It does not execute contracts, authenticate balances, or prove that a deployment exists.

The checklist requires authenticated accrued debt, custodial collateral, realised proceeds, fresh oracle/risk state, atomic Soroban settlement, rollback/conservation tests, verified contract bindings, signed Stellar Testnet receipts, and independent security review.

**Security boundary:** caller-provided booleans are claims, not evidence. Even when every field is true, `executable` and `tradingEnabled` remain false. Only future on-chain contract enforcement and independently verified receipts can establish readiness. The module must never be used as a trade permission check.

Next engineering dependency: implement atomic Soroban lending debt repayment from actual realised collateral, including cost priority, bounded insurance coverage, lender shortfall, rollback, and cross-contract authorization tests. Use disposable Testnet assets only. Public Testnet financial beta remains CLOSED; mainnet is out of scope.
