# Milestone 9 — Stellar Testnet bilateral spot settlement

**Status (31 October 2026): contract source and mocked/native Soroban tests implemented. Not deployed. No genuine Testnet DvP transaction hash exists.**

M9 is a deliberately isolated *delivery-versus-payment* (DvP) primitive, not the operational Hoxo exchange. It lets two wallet addresses authorise an **atomic** swap of two approved seven-decimal Soroban token contracts. Both parties must sign the exact same on-chain invocation. **M8's off-chain signed order intent is not a token-spend authority.** No Hoxo vault balance or margin is modified by this standalone contract.

### Implemented contract

- Package: \`contracts/spot-settlement\` (\`soroban-sdk =29.0.1\`).
- Constructor verifies canonical Stellar Testnet network ID, sets admin and starts **paused**. A non-Testnet ledger network ID cannot settle.
- Admin can approve exact 7-decimal token contract addresses, pause settlement or transfer admin with both old/new admin authorization. Admin **cannot sweep funds**; the contract holds no custody.
- Each \`settle(MatchTerms)\` call binds two distinct wallet addresses; approved distinct base/quote tokens; a fresh 32-byte match ID, two distinct order IDs; 7-decimal base/quote atomic quantities; maker side and two limit prices; and a ledger-sequence expiry no more than 100 ledgers ahead.
- Maker selling base: seller receives *at least* its minimum quote/base price, buyer pays *at most* its maximum. Maker buying reverses the side-specific inequalities. Every comparison uses checked integer cross-products (not floating point).
- \`maker.require_auth()\` and \`taker.require_auth()\` are required. Both 7-decimal tokens must transfer their **exact** requested amounts. A failed payment, deflationary transfer, or insufficient balance reverts the **entire** Soroban invocation.
- A persistent \`MatchId → SettlementReceipt\` record prevents replay, while \`SpotSettled\` emits an auditable event. Read-only \`receipt\` and \`is_settled\` endpoints are available.
- \`keepalive\` renews persistent match record/allowlist TTL. Expired/archived entries need a carefully reviewed restoration flow; event history alone is not an execution registry.

### M8 → M9 bridge

\`matching/core.mjs\` now includes maker/taker sides and limit prices in simulated fills. \`matching/settlement-preview.mjs\` deterministically computes prospective order/match bytes and integer quote quantities, but **always returns \`executionPermitted:false\` and \`settlement:"NOT_SETTLED"\`**. Without an independently verified M9 Testnet contract deployment, approved asset mapping, fresh deadline and two actual Soroban wallet signatures, the adapter is deliberately blocked. It is **not a settlement worker, auto-trader or order executor**.

### Tests and build

\`\`\`sh
cargo test -p hoxo-spot-settlement --lib
npm run test:spot-preview
npm test
\`\`\`

The CI workflow also invokes a \`wasm32v1-none\` Rust release-target build as a *compile smoke gate*. A raw \`cargo build\` does not replace the recommended \`stellar contract build\` CLI pipeline, contract artifact verification, signed deployment or audit.

The Rust tests cover both maker-side directions, dual-asset transfer balance accounting, price floors/ceilings, duplicate match IDs, invalid assets, pause/delist, zero/overflow amounts, expiry, a failed quote-payment rollback, rejected calls without auth mocks, unauthorised admin operations, TTL keepalive and wrong-network rejection. The JS tests cover deterministic M8→M9 previews, blocked missing contract/token deployment and rounding that violates a party's price bound.

### What is genuinely missing

1. **No Stellar Testnet operator/wallet deployment**: deployment WASM, signed transactions, contract ID, transaction hashes, event/receipt, token registry evidence and two-wallet ledger accounting are not verified. All six \`registry/testnet.json\` contracts remain marked **planned** with null IDs.
2. **No M8 fill authority inside M9**: bilateral wallet approval is required for every fill; the on-chain contract does not yet independently prove which M8 order was price-time matched or that a partial fill fits its remaining quantity. The off-chain preview is not trustless.
3. **No approved Testnet quote token**: current reference pairs are **not** issuer-verified or tradable. The contract needs independently reviewed 7-decimal token contracts and asset-specific security policies.
4. **No margin-settled spot**: M6 vault and M7 risk-engine state are not connected. The contract swaps the wallets' token balances, not unified-margin holdings.
5. **No production transaction handling**: fee bounds, wallet auth-entry signing for a two-party Soroban transaction, RPC preflight/finality monitoring, ledger-indexed receipt reconciliation, order reservation release/retry and crash recovery are not integrated.
6. **No security audit**: token compatibility, malicious/fee-on-transfer token behaviour, archival replay retention, fuzz tests and contract upgrades require review.

**Safety condition:** keep deposit, swap, spot and perpetual execution controls disabled in the terminal until the independently signed Stellar Testnet acceptance steps and M8 settlement bridge are completed. A passed unit test or healthy Stellar network is not evidence of a settled Hoxo trade.
