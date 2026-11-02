# M64 — Stellar Testnet spot reserve proof hardening

The existing M63 wallet-approved Classic DEX XLM/USDC SELL preflight previously interpreted missing Horizon `subentry_count`, `num_sponsoring`, and `num_sponsored` as zero. This could underestimate minimum XLM reserves and invite a failing wallet-signed transaction. M64 now rejects missing, negative, non-integer, unsafe, and inconsistent sponsorship metadata before constructing the sale. Tests cover valid metadata, all missing fields, malformed values, contradictory sponsorship and large account reserves.

This is a fail-closed **preflight** improvement, not proof of executed Testnet trading. The fixed 0.5 XLM base-reserve assumption is conservative only while Stellar Testnet base reserve remains 0.5 XLM; final transaction validity is always determined by Stellar consensus. The trade remains explicitly wallet-approved; no signing, broadcasting, M9 attribution, perps activation, or deployment occurs in this PR.

Run `node --test tests/m63-spot-dex.test.mjs` and full `npm test`. Merge only after CI and review. Confirm the Testnet reserve value against current network parameters before promoting any future public execution change.
