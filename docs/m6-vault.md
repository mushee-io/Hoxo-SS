# M6 — Soroban Testnet isolated collateral vault

The `hoxo-collateral-vault` package contains an account-isolated Soroban Rust contract pinned to `soroban-sdk =29.0.1` (the Stellar Testnet protocol at the time of implementation is 29). It is **not yet deployed to Testnet**.

Contract invariants:
- The admin is assigned by a **deployment constructor**, not an unprotected later init call. Admin must authorise allowlist updates, pausing new deposits, and dual-auth admin transfer.
- Only approved Stellar token contract addresses accept **positive token deposits**. Every deposit calls `owner.require_auth()` and the Stellar token interface, checks actual received balance, then atomically records the owner-specific token claim and tracked aggregate balance.
- Only the owner can withdraw their own recorded quantity. Admin cannot seize balances or block withdrawals by pausing deposits or removing an asset from the allowlist.
- Withdrawals check recorded amount, total accounted assets, actual vault holdings, transfer quantity and integer bounds. A failed token contract transfer reverts state atomically.
- `keepalive` is a permissionless TTL renewal function. Persistent balance and allowlist entries must be refreshed before archival; relying solely on an auto-renewal window would be insufficient to guarantee perpetual redeemability. An audited runbook and automated archival maintenance must precede public deposits.
- No lending, interest, borrow, trade margin or on-chain order reservation exists. **All deposits are isolated and freely withdrawable; the contract is not yet a unified-margin vault.**

Build/test: `cargo test -p hoxo-collateral-vault --lib`, then use Stellar CLI `stellar contract build` with the `wasm32v1-none` Rust target. Building a source package is *not* deploying a contract. A real Testnet deployment requires an admin-owned funded identity, `stellar contract deploy --network testnet --source-account <identity> --wasm <built-wasm> -- <constructor-options>` as supported by the installed CLI. Record transaction hash/ledger and independently query its contract instance before registering the contract ID.

**Security gates still open:** public asset/issuer review, protocol upgrade (Bell/Protocol 30 vote planned for 3 Nov 2026), WASM build and size check, genuine funded wallet deposit→withdraw verification, archival TTL runbook, invariant/fuzz tests, external security review and mainnet rejection.

No contract ID, deployment transaction hash or user funds are asserted by this milestone.

## CI confirmation

[GitHub Actions 41191757442](https://github.com/mushee-io/Hoxo-SS/actions/runs/41191757442): Soroban native vault tests **3/3 pass** on SDK29.0.1. No release WASM, RPC deployment, contract ID, transaction hash or account funding proof was produced by these tests.

## Additional authorization tests

On 31 October 2026, two additional negative tests were introduced: owner withdrawal without a signer and admin pause without a signer, both with `Env::set_auths(&[])` to disable the permissive test mocks. The M6 vault has **5 passing tests** in GitHub Actions run 41192089391. These tests do not replace a live multiwallet Testnet authorization assessment.
