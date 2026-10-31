# M14 — Maintenance liquidation and prefunded insurance

**Status: implemented as contract source and tests, pending independent Testnet deployment and economic audit.** The isolated contract is still Testnet-only, starts paused, and has no configured real M5 oracle or M7 canonical risk authority. Test-only mock controllers are not deployments.

## Liquidation safety

An on-chain price must be fresh (within 120 seconds) with mark/index deviation at most 200bps. `liquidation_preview(positionId)` computes long and short equity after pending mark PnL and funding, relative to the contract's illustrative 15% maintenance margin. It reports required insurance, available *prefunded* insurance, and `uncovered_bad_debt_e7`, which is a **read-only, potential shortfall**, not a recorded enforceable debt or an unbacked payout.

`liquidate(positionId,keeper,quantity)` requires a signed independent keeper address, different from both parties. It rejects healthy positions, stale oracle values, invalid quantities, wrong network, and funding intervals older than eight hours. It never applies invented historical oracle prices.

## Partial liquidation

Can reduce at most **50%** of a position's remaining base quantity per action. Realizes the closed slice's mark PnL into the same two locked escrow balances, retains collateral for the remaining exposure, and optionally pays the keeper out of the losing side's *own* remaining margin. Both residual equities must be safely above maintenance. Insurance is never used for partial liquidation. If equity cannot be restored, the action rolls back.

## Full liquidation and insurance

A full close computes both gross payouts. If one side's payout would be negative, the difference can only come from **actual previously deposited insurance tokens**. `fund_insurance(funder,amount)` requires funder authorization and an exact token transfer; it works even when new trading is paused, and does not give the funder a claim on other users. The reserve cannot be administratively swept or withdrawn from M14.

On an approved full insolvency close, insurance reserves fall by the exact deficit, and user claims rise by the exact same amount; actual tokens are unchanged. If reserves are insufficient, the liquidation rejects and the preview reports the uncovered gap. It never creates a fake winning payout or socializes the shortfall across unrelated users. Keeper rewards are capped to **50bps** of reduced notional and can only be drawn from a losing side's nonnegative payout. Reward configuration is admin-authorized only while paused and with no open positions; it defaults to 0bps.

Reconciliation now requires actual token holdings to cover **user claims + trading fees + independent insurance reserves**. Unsolicited token transfers are surplus, not user equity or insurance. Closed IDs cannot be reused. Events and position state record liquidated quantity, keeper reward, insurance usage and realized PnL.

## Important remaining risks

- M13 funding older than **8 hours** still blocks liquidation and close: no historical TWAP recovery or safe forced exit exists. Public funds must not be accepted in this state.
- The existing M5 and M7 contracts do not establish an approved oracle or independently verified canonical on-chain margin authority. A malicious configured controller remains unsafe.
- Real contracts, asset issuers, funded-wallet deposits, liquidations and verified transaction hashes are **absent** from the Testnet registry.
- There is no unattended keeper service, reliable contract restoration after Soroban TTL archival, external insurance funding plan, or independent audit.
- A read-only predicted bad debt is **not** an executable write-off or guarantee to cover all possible losses. If insurance is inadequate, the position stays open rather than leaving an unbacked creditor.
- M12–M14 use **isolated** margin, not an M6 unified vault or M11 money-market debt account. M15 is the integration milestone.

Run `cargo test -p hoxo-perp-clearinghouse --lib`, `stellar contract build --package hoxo-perp-clearinghouse`, and `npm run check:readiness`.

Release requires reviewed genuine Testnet oracle/risk contracts, independent signed wallet liquidation tests, pre-funded on-chain insurance, authenticated historical funding recovery, keeper operations, bad debt/reorg/TTL handling, and an external security and economic audit. **No public perp trading or custody must be enabled on these source tests alone.**
