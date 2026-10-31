# M15 + M5 — Chain-backed spot reservation risk controller

**Status:** contract source and native Soroban integration tests; not independently audited, not deployed, no financial public beta. A **single valueless collateral asset** is supported in the canonical M15 ledger. **Neither real spot token-for-token exchange nor lending/perpetual cross-margin is implemented.**

## Why risk approval is a two-operation protocol

A naïve callback would be `M15.reserve() → Risk.approve_reservation() → M15.account()`. Stellar Soroban **forbids contract re-entry**. This real restriction was exposed by the native integration test; the recursive design failed with `Error(Context, InvalidAction)`.

The new approved-flow design uses **two owner-authorised operations**:

1. **`CanonicalRisk.prepare_spot_reservation(owner, id, amount_e7)`:** The signing owner asks the risk contract to read the genuine deployed M15 vault and price oracle. This is outside any active M15 execution call, so reading M15's immutable `collateral_asset()`, owner `account()`, global `totals()` and `solvent()` is legal. The controller cross-checks the actual token balance of the canonical vault, positive collateral claims, available units, current reserved units, a fixed maximum owner reserve and a fresh on-chain candidate price. It records one owner-specific 32-byte reservation ID, exact amount, product **Spot (1)** and a maximum 20-ledger expiry. It rejects a second outstanding permit until the first is consumed, cancelled or expires.
2. **`UnifiedMargin.reserve(owner, adapter, Spot, id, amount_e7)`:** M15 already checks exact owner and allowlisted adapter authorisations, its own available collateral, solvency, replay ID and deposit/role pause. It calls `CanonicalRisk.approve_reservation(owner, vault, asset, Spot, id, amount)`. Risk reads and consumes the **exact one-time permit** and independently refreshes the on-chain oracle, but **does not call back into executing M15**. The entire Soroban transaction is atomic: if the outer M15 reserve reverts, the risk-permit removal is rolled back.

Both operations require a separately valid Stellar Testnet wallet authorisation. They cannot be simulated as user-signed network transactions by reading account balances or a GitHub test. The preflight and reservation may have separate transaction hashes and ledgers; **neither exists yet on the public Testnet**.

## Implemented security checks

- Soroban network ID must be the exact canonical Stellar Testnet ID. No mainnet.
- Constructor admin signs immutable addresses for M15 vault, 7-decimal token, one candidate two-publisher oracle, one market ID and a fixed bounded per-owner reservation cap. It starts **paused**; only admin can change pause.
- Only physically backed, non-negative and available **M15** collateral is eligible. A caller cannot supply their own collateral or prices to approve a permit.
- Candidate oracle must produce two on-chain publisher reports, both fresh (120s), and the mark/index gap must be no more than 200bps. This is not a market-data audit or real-world independence guarantee.
- Permit bound to the exact owner, amount, 32-byte ID and **Spot product only**, at most 20 ledgers, one outstanding per account. Permit consumption also requires owner signature and a fresh oracle. Direct risk approval may consume the owner's own permit but cannot move tokens.
- M15's own owner/adapter auth, replay rejection, free/reserved accounting, token-vault solvency and immutable reservation tombstones remain authoritative. Owner may withdraw **unreserved** collateral even during a risk or deposit pause.
- **Lending and perpetual authorisations always return false.** No borrow may be backed by an M15 reservation until accrued lending debt, positions, funding, liquidation and token claims share audited, atomic, on-chain accounting.

## Source

| File | Function |
| --- | --- |
| `contracts/canonical-risk/src/lib.rs` | Testnet two-stage M15 collateral-backed, one-use spot reservation permits |
| `contracts/canonical-risk/src/tests.rs` | Native cross-contract integration: real M15 ledger, candidate oracle, ID/amount forgery, expiry, pause, solvency and denial cases |
| `contracts/unified-margin/src/lib.rs` | New immutable `collateral_asset()` read getter; exact ID forwarded to risk approval |
| `contracts/unified-margin/src/tests.rs` | Existing mock risk clients updated to accept the 32-byte reservation ID; their mock approvals remain non-production |
| `beta/deployment-plan.mjs` | `risk-engine` deployment role now uses `hoxo_canonical_risk.wasm`, **spot-only**, not M7's separate preview contract |
| `deployment/testnet-operator.mjs` | Requires independently checked `riskVaultContract`, `riskOracleContract`, valueless token contract and bounded maximum owner reservation before preparing an operator-owned Testnet deployment |

The original M7 analytical contract remains `hoxo-risk-gate`, **preview-only**, and is not silently promoted to a real leverage authority.

## Critical outstanding architecture

The present `M15.authorization_enabled()` external risk method is a **global capability check**. It does not distinguish the product the administrator might bind or mark enabled. The new controller returns true for global readiness only once unpaused, but explicitly refuses product codes 2 and 3 and separate M11 `approve_borrow` / M12 `approve_open`. This is a **transitional interface**, not a basis for displaying lending or perpetual credit.

M9 spot delivery-versus-payment trades two external tokens and does **not** call M15; its settlement is not implemented by a reservation permit. M11 money-market share/debt pool and M12 perpetual clearinghouse still transfer a **different** isolated token escrow. Binding them to this narrow risk guard intentionally denies new borrowing/open positions rather than double-counting the user's M15 collateral.

**To complete true unified margin**, build independently audited product-specific adapters and canonical state reads for on-chain debts with interest, positions/funding, oracle prices, insurance and total claims; redesign M11/M12 custody to atomically debit and credit M15, and prove safe liquidations/settlements and withdrawal behaviour across the entire system. One token-backed spot reservation alone is not an exchange.

## Verification and launch gates

```sh
cargo test -p hoxo-canonical-risk --lib
cargo test -p hoxo-unified-margin --lib
stellar contract build --package hoxo-canonical-risk
npm run check:readiness
npm run m21:readiness
npm run m22:readiness
npm run m23:readiness
npm run m24:readiness
```

Passing the tests means **native source contracts passed**, not that an external audit, public Stellar Testnet deployment, real signed economic transactions or the M23 financial beta were completed. Any real Testnet deployment requires reviewed source/WASM, independent local signing keys, separately funded valueless wallets, verified external RPC evidence and explicit operator governance. No mainnet/financial beta privileges are conferred.


## Subsequent M9/M11/M12 custody-routing integration

An additional isolated **atomic custody router** now connects M15's *FREE* quote collateral to the M9 two-token DvP path, and can migrate actual token units and claims between M15 and M11/M12 when those product escrows have zero debt/open positions. It checks that no user can hold both M15 spendable credit and duplicate isolated custody for the same token units. This does not yet execute against M15's **reserved** spot orders or provide common leveraged collateral. Read [actual custody integration and remaining blockers](m15-m9-m11-m12-custody-routing.md). No independently verified live Testnet actions or security audit.
