# M43 — Browser dual-wallet Freighter authorization guard (non-broadcasting)

This is an **integration boundary**, not an operational trading terminal. The pure browser module `app/m43-freighter-auth-guard.mjs` provides explicit sequential maker/taker user approvals, requires distinct exact public G-addresses and Testnet network passphrase at each approval, and rejects injected secret fields/accessor objects. It does not generate, submit or sign any transaction without the user's explicit `approve(role)` call. The caller must supply the actual reviewed Freighter API adapter; the terminal is **not wired to it yet**.

A real implementation must generate Soroban authorization entries by simulating the **exact reviewed M9 settle invocation** with the expected contract, both assets, match ID, expiry and amount, then validate the decoded invocation trees, credential addresses, nonce and expiration against the simulation. The signed entries returned by Freighter must be independently decoded and cryptographically verified before attachment to a fresh, bounded-fee transaction. This guard deliberately marks all signatures `verified:false` and `broadcast:false`. It does not persist signed XDR, automatically switch wallets, ask for private keys, or allow mainnet.

## Required next steps
1. Complete and independently review M42's two `set_asset` administrative approvals while M9 remains paused; refresh M41 live read-only checks before and after each action.
2. Implement a browser bundle using the pinned official Stellar SDK and Freighter's documented `signAuthEntry` method, with explicit user clicks and exact G-address/network display.
3. Add Soroban XDR parsing and verification, per-wallet credential checks, simulation freshness, expiry and transaction fee ceilings, replay protection, and genuine signed receipt reconciliation.
4. Independently review the unpause/spot-only gate before any signed settlement. Never count self-owned test accounts as genuine external trade volume.

Run `node --test tests/m43-freighter-auth-guard.test.mjs`. This feature does not enable lending, perps, public beta or any order submission.

## M43 approval concurrency hardening

The handoff now allows at most one in-flight Freighter approval, preventing double-click or concurrent UI actions from creating two prompts for the same maker/taker role. It reads the selected wallet and Testnet passphrase again **after** the wallet returns a signed entry; a mid-prompt wallet or network switch rejects the result and leaves the role unapproved. Rejected prompts clear the in-flight lock for an explicit retry. Regression tests cover concurrency, account/network switching and safe retry.

This is defense in depth, **not cryptographic authorization verification**. A malicious adapter can lie about the selected wallet; the eventual integration must independently decode and verify signed Soroban auth entries, expected invocation tree, nonce and expiration, exact contract/assets/amounts and ledger freshness before any broadcast. Never unpause or count volume on the strength of this guard.

## Freighter response hardening

The adapter response must be a plain own-data object containing only `signedAuthEntry` and optional `error`. Accessor-backed or symbol properties, unexpected secret fields, unbounded/malformed base64 and unchanged unsigned entries are rejected before the approval counter advances. This is a syntactic defense only: valid-looking base64 is **not** proof of a valid signature. Signed Soroban XDR, address credentials, exact invocation tree, expiry and transaction submission remain unimplemented and disabled.
