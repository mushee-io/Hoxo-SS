# M44 — Real Freighter browser adapter + SDK XDR verification (OFFLINE)

**Milestone status: engineering verification only, NOT an executable or published trading terminal.** This PR continues M43 #34 in draft. The deployed M9 spot settlement contract remains paused. No code in M44 calls an RPC broadcast, Freighter \`submit:true\`, admin \`set_pause(false)\`, contract \`settle\`, or uses wallet secrets. The standalone utilities are **not yet connected** to Hoxo's Trade page.

## Delivered

1. \`app/m44-freighter-adapter.mjs\` wraps the official Freighter SEP-43 API, available from \`window.freighterApi\` or the official packaged module, for the exact operations:
   - \`getAddress()\` with a validated public G-account.
   - \`getNetwork()\` requiring canonical Stellar Testnet.
   - \`signAuthEntry(unsignedXdr,{address,networkPassphrase})\` returning a signed non-source authorization and enforcing returned signer address.
   - \`signTransaction(preparedXdr,{address,networkPassphrase})\` signing the **maker/source** envelope with an explicit **\`submit:false\`**.
   - Every result is checked for unexpected fields, error replies or accessor objects. The adapter never calls \`requestAccess()\` automatically and has **no send method**.
2. \`app/m44-stellar-xdr-verifier.mjs\` uses **pinned @stellar/stellar-sdk 17.4.0** for strict XDR decode and offline verification:
   - One and only one M9 \`settle\` operation with no other operation source, exact contract, match ID, distinct maker/taker/order IDs, 13 reviewed Soroban argument fields and their exact XDR types.
   - Exact canonical Testnet XLM and Circle USDC SAC addresses, positive seven-decimal integer amounts, bilateral price bounds, fresh ledger expiry (at most 100 future ledgers) and fee ceiling.
   - Original simulation must contain the expected taker unsigned auth entry (and at most one source-account auth entry). Any unrelated, signed-in-advance or substituted entries fail closed.
   - Signed taker XDR must match the simulated invocation tree, authorizer address and nonce; be unexpired and in permitted ledger horizon; use a single standard Ed25519 signer whose public key is the exact taker.
   - Reconstruct the Protocol 27/28 auth preimage with the **SDK's buildAuthorizationEntryPreimage** (v1 and v2 credential-aware), and verify the 64-byte Ed25519 signature cryptographically with \`Keypair.fromPublicKey(taker).verify\`. Custom/delegated smart-account signatures are intentionally **not supported**, rather than presumed valid.
   - \`createM44EnvelopePreparer(...)\` produces the **auth-attached unsigned** maker transaction using \`TransactionBuilder.cloneFrom\`, preserving any simulated source-account auth entry. M43's existing source-wallet \`signTransaction\` flow can use this callback.
   - \`verifyM44MakerEnvelope\` compares the maker-signed XDR's transaction hash and sole signature against the exact unsigned prepared body; verifies the source account's Ed25519 signature. It never submits.

## Boundaries

- The module does not create the original RPC simulation or fetch the latest ledger. Both must be obtained from trusted, fresh Testnet RPC evidence **immediately before each signing round**. Passing \`currentLedger\` from an untrusted page or faking a simulated envelope undermines the preflight.
- The XDR verifier requires \`expectedTerms\` to be an independent, previously reviewed exact MatchTerms object, not terms inferred from the wallet's signing prompt. Its output remains \`broadcast:false\`, and signature verification alone is NOT permission to trade.
- \`createM44EnvelopePreparer\` is a callback building an unsigned auth-attached envelope. It is not a full production-grade SDK simulation coordinator, balance/reservation checker or submission worker.
- \`verifyM44MakerEnvelope\` must be called only on the exact previously vetted prepared envelope; a separate orchestration layer must retain the expected exact MatchTerms, simulation hashes and signed taker auth evidence across both signing stages.
- The Hoxo website is a plain-browser app. The SDK module imports from \`@stellar/stellar-sdk\` and requires a reviewed version-pinned browser bundling step before wiring it to the UI. Loading its bare package import directly from a non-bundled HTML module would fail. **No live browser wiring is claimed here.**
- Actual Freighter interactive use has not been tested here: tests use a mock SEP-43 extension surface and real SDK XDR/Ed25519 fixtures, not a connected wallet. No user keys are requested or stored.
- Public trading requires independent browser wallet testing, a verified fresh simulation, exact dual consent, an audited explicit opt-in Testnet-only broadcast gate, on-chain \`receipt(match_id)\` and \`is_settled\` proof, balance reconciliation, fail-closed recovery, and separate contract activation approval.
- The M9 contract stays paused; do not sign \`set_pause(false)\` on M44 alone. Perps/lending/unified margin/mainnet remain disabled.

## Developer verification

\`\`\`sh
npm run test:m44
npm test
\`\`\`

These tests build real Stellar SDK XDR fixtures and cryptographically signed authorization/envelope samples, exercise tampering/replay/wrong signer and wallet network protections, and assert \`submit:false\`/no-broadcast. Passing the suite verifies module behavior, **not** a live swap.

## Next milestone — M45 separate controlled Testnet integration

Add a version-pinned browser bundle, an explicit user-facing trade review and two-wallet Freighter prompt flow, fresh RPC simulation and fee/expiry checks, an independent security review, and only then an opt-in on-chain settlement acceptance procedure. The two source wallets may be controlled by one person; that is an internal test, not community trading volume.

References: [M43 corrected guard](../app/m43-freighter-auth-guard.mjs), [M44 adapter](../app/m44-freighter-adapter.mjs), [M44 verifier](../app/m44-stellar-xdr-verifier.mjs), [M9 contract](../contracts/spot-settlement/src/lib.rs).
