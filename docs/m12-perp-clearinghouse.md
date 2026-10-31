# M12 — Isolated bilateral perpetual clearinghouse

**Status:** Code and Soroban test suite for a Stellar **Testnet-only** perpetual clearinghouse. Not deployed. There is **no approved M5 oracle or M7 risk authority contract**, no live funded accounts, and no real Hoxo trading activity.

## Contract

`contracts/perp-clearinghouse` is a dedicated isolated collateral/position contract using Soroban SDK `=29.0.1`. Its constructor requires the actual Stellar Testnet network ID, an authorised admin, a 7-decimal Soroban collateral token and one market ID. It starts **paused**, and its on-chain oracle/risk-controller addresses are unset.

The admin must configure **two distinct controller contract addresses once**, while paused. The admin can pause *new* deposits and positions but cannot sweep or confiscate user balances. Whether a configured controller is economically secure must be independently audited; the built-in default does not establish that.

### Isolated collateral
- `deposit(owner, amount)` verifies the user's Soroban signature and exact 7-decimal token transfer. Each wallet has available and locked balances. The contract tracks aggregate user claims and checks actual escrow token solvency.
- `withdraw(owner, amount)` requires the user's signature, can withdraw only **free** collateral, and remains available when new deposits are paused. Locked margin cannot be withdrawn.
- Collateral stays **inside this M12 contract**, not in M6. This is NOT a shared unified-margin account and does not lend/borrow from M10/M11.

### Open a bilateral position
- `open(positionId, long, short, quantity, longMax, shortMin, deadlineLedger)` requires **both independent wallets** to authorise the exact Soroban invocation.
- Reads an external Soroban oracle's mark, index and timestamp; requires positive values, update age ≤120 seconds, no future data and mark/index deviation ≤200 basis points. **No caller-supplied oracle price is accepted.**
- Validates both counterparties' limit prices, positive bounded notional, maximum 100-ledger deadline, unique 32-byte position ID and maximum 1,000 simultaneous positions.
- Both wallets must have enough available escrow. It reserves **25% initial margin on each side** (illustrative, not an audited leverage setting) and asks an external on-chain risk authority to independently approve the signed long exposure and signed short exposure.
- The position records long/short accounts, entry mark, quantity, reserved margins, opening timestamp and an active flag. An event records the opening.

### Close a bilateral position
- `close(positionId)` currently needs signatures from **both original parties**. It reads a fresh, divergence-bounded oracle mark.
- `longPnL = quantity × (exitMark - entryMark) / 10^7` with checked integer arithmetic. Long and short PnL are opposite. Profits debit the loser's locked margin, credit the winner, and release the remaining escrow atomically. There is **no minting or external money created by the position close**.
- A close that would exceed one side's locked margin fails closed, leaving funds reserved for M14 liquidation/insurance development. It does not forgive debt or create synthetic credit.
- The position ID is preserved as a closed record to prevent reuse. `keepalive(long, short, id)` renews Soroban persistent storage TTL and instance lifetime; archival recovery and an independent keeper are release prerequisites.
- Closing can continue while *new* trading is paused, provided the oracle remains fresh and both wallets cooperate. **Neither forced/unilateral closes nor liquidations are implemented.** A non-cooperating counterparty or failed oracle can leave margin inaccessible until further safety infrastructure exists.

## Tests and build

```sh
cargo test -p hoxo-perp-clearinghouse --lib
stellar contract build --package hoxo-perp-clearinghouse
npm run check:readiness
```

Native Soroban mock contracts are used to test the oracle/risk interfaces; **they are not proof** that M5 and M7 are ready, audited or deployed. CI must pass unsigned-wallet, wrong-network, stale/deviant-price, limit/slippage, margin, profit/loss, pause, replay, risk-denial, solvency and persistent-record tests. WASM compilation produces a review artifact, not a contract deployment.

## Blockers before genuine Testnet trading

1. Independently verify and deploy a true on-chain Stellar Testnet **M5 oracle** and an authenticated **M7 canonical risk authority** that reads collateral, debts, orders and position state itself. Existing M7 only takes user-provided snapshots and always refuses trading authorization.
2. Review/approve an actual valueless 7-decimal collateral token and secure funded Testnet wallet accounts. Review admin/risk/oracle governance and the ability to move a stuck position if one party does not cooperate.
3. Build and deploy the signed M12 WASM, capture actual transaction hashes/ledgers and independently query state. The contract role remains `planned` with null ID in `registry/testnet.json`.
4. Test two independently controlled Stellar wallets across deposit → bilateral open → oracle update → bilateral close → withdraw, including failed signatures and stale feed simulations, and reconcile event logs and escrow token balances.
5. Deliver **M13 mark/index funding, fees and realised settlement reconciliation** plus **M14 keeper liquidations, insurance, unilateral close rules and bad debt management** under independent security review.
6. Integrate M6, M7, M9, M11 and M12 with canonical shared collateral in **M15**. Current margin is isolated; it is not reusable across positions, spot orders or lending.
7. Audit the smart contract for malicious oracle/risk contracts, TTL/replay archival, signed approvals, contract upgrades, precision/truncation and economic failure modes before permitting third-party funds.

**Do not enable the public terminal's real perp or custody buttons from source-code tests alone. No live Testnet perpetual position or settlement has been claimed.**
