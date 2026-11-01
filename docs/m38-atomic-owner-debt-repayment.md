# M38 — atomic owner-authorized M15-to-M11 debt repayment

**Status: executable native Soroban integration, valueless Stellar Testnet candidate only. NOT DEPLOYED, NOT A LIQUIDATION ENGINE. Financial beta remains CLOSED.**

## Executable scope

The custody-router now exposes `repay_debt_from_margin(owner, amount_e7)` on its existing Testnet-only nine-contract graph. It lets an owner pay down **their own already-existing M11 lending debt** using only **available/unreserved M15 margin**:

1. Validate exact Stellar Testnet chain, configured canonical seven-decimal token, router pause state, bounded positive amount and genuine owner authorization.
2. Read borrower debt from M11's on-chain, interest-projected `debt_of(owner)`. Refuse nonexistent/stale or oversized debt. Reject if the owner's actual M15 FREE (not reserved) balance is insufficient.
3. Verify the actual M15 and M11 token custody is backed by recorded cash/claims.
4. Under **one Soroban root contract invocation**, M15 `withdraw(owner, exactAmount)` debits the owner's available claim and sends that asset to their wallet; M11 `repay(owner, owner, exactAmount)` requires that same owner's authority, transfers the same token back to the lending pool, burns actual debt shares and adjusts accounted cash.
5. Check exact token deltas: M15 custody **minus paid**, M11 custody **plus paid**, owner's wallet **unchanged**; M15 total user claims and available owner balance **minus paid**, M11 projected total market debt **minus paid**, owner debt decreases, and both custodians remain solvent.
6. If M11 interest/share rounding yields a different payment amount, if the owner cannot authorize or cover the free amount, if either token transfer or source contract fails, or if any invariant fails, the entire root transaction fails closed. The amount must match M11's actual repayment exactly.
7. Return a concrete `DebtRepayment` contract result with source/destination, owner, token, amount, before/after debt, ledger, and explicit `liquidation_executed=false`.

**Authority constraints:** This is a **voluntary owner-initiated debt repayment**, not permissionless seizure, liquidation, debt write-off, insurance waterfall, lender claim settlement across accounts, or a mechanism for opening new M11 loans. The router still starts paused; production credit remains hard-disabled without a reviewed canonical risk controller. Direct M15 owner withdrawal and direct M11 repayment remain possible when this convenience router is paused.

## Tests

Native `cargo test -p hoxo-custody-router --lib` now includes cases for an existing native test-only M11 debt and actual Soroban token transfers:

- A full loan repayment across M15 and M11 with total claim and debt conservation and unchanged owner wallet balance
- Exact partial repayment followed by full repayment; overpayment rejected
- No loan, zero/negative amount, unauthorized payer and excessive amount rejection with no state movement
- Insufficient **free** M15 balance, ensuring reserved/absent claims cannot be spent
- Router pause with independent direct owner withdrawal and direct repayment remaining possible
- An existing loan accruing seven days of on-chain interest and exact debt-share cleanup

Borrowing in these tests is activated by a **local-only fake permissive risk contract** with `Env::mock_all_auths()` for fixtures. It is **not a live authorization**: the shipped canonical risk authority still returns false to `approve_borrow` and `approve_open`. The native tests do not broadcast or verify Stellar Testnet transactions.

## Work still blocking working live trading

1. Independently reviewed and funded valueless Testnet token/issuer and external operator-controlled signer, followed by genuine verified contract deployment transaction hashes and reviewed WASM hashes/constructors.
2. Genuine M15/M11 owner wallet signing, Testnet funding, debt/repay receipts, ledger state proofs and token before/after checks on publicly deployed contracts.
3. A separately audited **permissionless** liquidation entrypoint with genuine on-chain risk/position/borrower state, eligible collateral seizure, atomic M11 debt share write-down and M12 settlement, real insurance consumption, shortfall reporting and replay-safe keeper incentives. M38 does **not** do any of this.
4. Independent smart-contract and economic security audit, bounded live gas and TTL/archival maintenance drills, risk/governance approval before a public Testnet financial beta.

**No mainnet capability or real-money transaction is authorized.**
