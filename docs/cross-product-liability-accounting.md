# Cross-product M15 / M11 / M12 liability reconciliation

**Status: new read-only Soroban source and native tests. No independently verified deployed Hoxo contract IDs, no real wallet-signed public Testnet financial transactions, no independent audit, and no public financial beta.** This is **not** a completed leveraged trading risk engine. All financial execution approvals intentionally return `false`.

## Why an accounting snapshot is necessary

M15 holds physical token claims in one vault, M11 holds its own pool shares, loan receivables and accrued-interest index, and M12 holds isolated collateral, position locks, insurance and trading fees. A valid cross-product statement must read all three **actual on-chain contract states**, distinguish token holdings from receivables, and reject attempts to give users spendable credit in more than one vault for the same token.

The earlier custody router physically transfers tokens and burns/creates separate book claims rather than minting a second claim. The new `hoxo-portfolio-accounting` contract turns these distinct book ledgers into one **read-only** per-owner and global view.

## Added M11 current-ledger projections

`MoneyMarket.projected_portfolio(owner)` calls the existing `compute(env,false)` interest accrual **without writing any state**. Its output contains the exact collateral token, actual M11 token cash, accounted pool cash, total shares, owner shares, projected nominal owner supply claim, projected owner debt, total projected borrowed value, protocol reserves, borrow index and ledger timestamp. It is **not a price oracle**, and the output `real_credit_risk_approved` is always `false`.

The owner share claim is derived from projected lender assets, **cash + nominal loan receivables − protocol reserves**, pro-rated by actual owner share units. Debt is computed with the on-chain borrower-debt index and conservative rounding. A share claim is **not simultaneously liquid M15 collateral**; withdrawal liquidity and borrower default risks are not priced.

The additional `MoneyMarket.current_outstanding_debt_e7()` read now protects the isolated custody router. Unlike the previously stored historical pool principal, it includes interest through the current ledger. When accrued interest is more than 30 days stale and must be brought forward by a keeper, `compute(false)` fails and the custody handoff **reverts**. Existing repay/share-redemption exit mechanisms remain independent of this observer.

## New `PortfolioAccounting.snapshot(owner)` model

Every value is sourced from a real Soroban contract read, never from a caller-supplied cash balance, price, collateral weight or PnL claim.

| View | Meaning |
| --- | --- |
| M15 available / reserved | Exact owner free and locked physical collateral claims |
| M11 supplier nominal | Owner's book share of *cash + accrued loans − protocol reserves* |
| M11 borrower debt | Owner's actual debt shares projected to this ledger |
| M12 available / locked | Owner's existing isolated perpetual collateral and reserved margin |
| Owner gross book assets | M15 claims + M11 nominal shares + M12 wallet claims; M11 debts separately subtracted |
| Total physical cash | Actual token holdings in M15, M11 and M12 addresses |
| Nominal lending receivables | Borrowed principal with projected accrued interest; this is **NOT** spendable cash |
| Nominal book assets | Physical cash + nominal lender receivables |
| Nominal liabilities | M15 user claims + M11 lender claims + protocol reserves + M12 user claims, fees and insurance |
| Liquid cash minus liabilities | Shows a real liquidity deficit when capital is on loan (even if nominal book appears balanced) |
| M12 global open positions | A safety indicator: any open position makes unrealised mark/funding/PnL and per-account position enumeration **INCOMPLETE** |
| Risk authority | Always **DENIED** for borrow, perp-open, financial Testnet beta and mainnet |

All token asset addresses must match the constructor-bound canonical seven-decimal token. Soroban reports negative, overflowed or inconsistent state as an error. M15, M11 and M12 independent solvency checks remain binding.

### Important accounting and safety distinctions

- A loan creates **nominal lender receivables**, not new physical tokens. Nominal book coverage does *not* establish creditworthiness, loan recoverability, mark-to-market solvency or the ability to meet immediate cash withdrawals.
- A perpetual position can generate unrealised PnL, margin calls, unaccrued funding and liquidation losses. The existing M12 contract does not provide a canonical enumerable per-owner position set or all pending obligations. These amounts **cannot be safely reconstructed from aggregate locked collateral**. The snapshot exposes `full_perp_exposure_enumerated:false` whenever any position is open, and it never grants trade rights.
- Owner net book collateral is explicitly **before unrealised perp PnL**. It is not a tradable account balance.
- The financial beta and mainnet approval flags cannot be switched through this source code, a document hash or a CI pass. Both are hard-disabled.
- The read-only snapshot cannot transact, move funds, approve credit, assert independent audit or validate legal status.

## Verification

```sh
cargo test -p hoxo-portfolio-accounting --lib
cargo test -p hoxo-custody-router --lib
cargo test -p hoxo-money-market --lib
stellar contract build --package hoxo-portfolio-accounting
npm run check:readiness
npm run m21:readiness
npm run m22:readiness
npm run m23:readiness
npm run m24:readiness
```

The native tests cover actual token-backed collateral held in the individual Soroban vault contracts, M11 share migration, borrower debt and interest accrued to current ledger, time-overrun failsafe, active M12 position incompleteness, mocked custody deficit and unauthorised read-only access. Test mock addresses are **not real Stellar Testnet wallet-signed transaction evidence**.

## Remaining engineering / external acceptance

1. Design immutable, auditable per-owner M12 position enumeration, mark/funding PnL, liquidation and insurance obligations. Risk calculations must use independently authenticated and fresh prices rather than caller-supplied values.
2. Build an **executable** canonical risk engine that checks cross-contract liabilities and new loans/positions atomically, with debt interest/insurance/market liquidity buffers. It must not rely solely on this aggregate reporting contract and must avoid prohibited Soroban contract re-entry.
3. Integrate a reservation-aware M9 settlement workflow for M15 locked rather than free spot collateral.
4. Commission external Stellar/Soroban security/economic review of the exact contract source and build artifacts, including M9/M11/M12/M15 and the new routing/portfolio contracts; fix critical/high findings.
5. Deploy independently verified valueless contracts and wallets on public Stellar Testnet with authorised operator keys, collect actual receipts and before/after economic balances for M21.
6. Only after the independent go/no-go decision, open a valueless **public financial Testnet beta**; mainnet remains **NO-GO**.

**Scope delivered:** current-ledger debt + loan-asset projections, consolidated nominal liability coverage, credit-risk/liquidity distinctions and fail-closed Testnet-only accounting foundations. **Scope NOT delivered:** executable audited shared margin, live public financial Testnet or mainnet.


## Subsequent M12 owner-indexed marked exposure and M15 spot enforcement

The updated M12 contract maintains a bounded on-chain **32-position active index per wallet**, updated atomically on open, close and full liquidation. It now calculates real oracle-marked per-wallet PnL, unpaid funding, marked equity, maintenance requirements and insolvency deficits. The portfolio snapshot includes these values and a `m12_owner_marked_complete` flag, while retaining `full_perp_exposure_enumerated:false` for any market-wide open positions (full market liquidation/exposure accounting is still outstanding). Its marked owner net is **not withdrawable collateral**.

The independent `PortfolioAccounting.spot_reservation_safe` check refuses spot preflights while **any** M11 debt or M12 position is open or when on-chain coverage is insufficient. The M15 canonical spot risk contract now requires an irreversible `bind_products(portfolio,lending,perp)` administrative setup while paused. Its preflight reads all three products; its one-time permit consumption rechecks live M11 debt and M12 position count without reentering M15. Both are spot-only checks, not authority to borrow, open perpetuals or run the financial beta. See [M12 risk integration](m12-marked-exposure-and-risk.md).


### Update: actual bounded market-wide position enumeration

The M12 clearinghouse now maintains a bounded global active-position list and exposes `market_exposure()` with real, on-chain verified position counts, owner escrow locks, zero-sum mark/funding legs, current maintenance requirements and aggregate negative-equity insurance deficits. `full_perp_exposure_enumerated` is now **true when the entire bounded market's active index, owner matches and wallet collateral are verified**, even if positions are open. This does **not** imply that the global liquidation waterfall, slippage, stressed price changes or executable cross-product leveraged credit has been audited. Public financial beta and mainnet remain disabled. See [market-wide M12 accounting](m12-market-wide-solvency.md).
