# M33 — Accessor-free waterfall input snapshots

The read-only asset-bound debt waterfall rejects accessor properties (getters/setters) and reads validated own data-property descriptors instead of evaluating caller-supplied getters. This prevents a malicious or accidental getter from executing during token validation or changing amounts between checks. The regression suite verifies that getters are never invoked and that non-enumerable data values still receive monetary validation.

This is **not** authenticated Stellar contract state, proof of a canonical token, or executable debt settlement. Proxies and other untrusted JavaScript objects should not be treated as a trusted ledger boundary. Never authorize a liquidation, borrow, or token transfer using this preview. Actual M11/M12/M15 atomic on-chain settlement, signed Testnet evidence, deployment verification and independent audit remain required. Public financial Testnet beta stays CLOSED; mainnet is out of scope.
