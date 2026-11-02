# M43 — Testnet M9 Freighter two-wallet signing handoff (NO BROADCAST)

**Status: browser-compatible role/ordering guard only. No executable spot trading, verified signed transactions, contract unpause, or broadcast. This PR remains a draft.**

## Corrected source/non-source roles

The existing [M9 Node reference](../matching/m9-wallet-settlement.mjs) treats **maker / Wallet 1** as the **transaction source** and **taker / Wallet 2** as the independent **non-source Soroban authorization signer**.

| Order | Wallet | What it must sign | Freighter API |
| --- | --- | --- | --- |
| 1 | Wallet 2 (taker; non-source) | Exact Soroban authorization entry for simulated M9 settle | signAuthEntry |
| 2 | Wallet 1 (maker; source) | Reviewed transaction envelope **containing the taker's signed auth** | signTransaction |

The maker is **not** asked to sign a second Soroban authorization entry. The old design requiring makerAuthXdr plus takerAuthXdr was incorrect for this transaction shape.

The browser guard now accepts only: canonical Testnet passphrase, pinned deployed M9 contract ID, distinct public maker/taker G-addresses, sourceTxXdr (unsigned envelope), takerAuthXdr (the one non-source entry), and exact 32-byte lowercase hex matchId. All fields must be own plain properties; secret fields, accessors, malformed base64, wrong network and substituted contract fail closed.

## Explicit user-controlled sequence

1. createDualWalletHandoff(input, freighter, prepareEnvelope) requires an injected reviewed wallet adapter supporting getNetwork, getAddress, signAuthEntry, signTransaction and a separately reviewed SDK-powered prepareEnvelope callback. The module itself never contacts a wallet unless a user calls approve explicitly.
2. First, approve("taker") checks Wallet 2 and the exact Testnet passphrase before and after signAuthEntry(takerAuthXdr, ...). It checks plain response shape, optional signer address, canonical base64 and refuses an unchanged unsigned entry.
3. Then approve("maker") checks Wallet 1, calls prepareEnvelope with the source unsigned envelope and the signed taker authorization, validates a distinct canonical prepared envelope, checks wallet/network again, and calls signTransaction on the **prepared** envelope. It checks optional signer address, unchanged input and wallet/network again.
4. No double prompts, reordering, duplicate approvals or concurrent signing. Errors do not advance the phase; retry requires a separate explicit action.
5. Both results and status remain verified:false and broadcast:false. There is intentionally **no send or submit function**.

### IMPORTANT: What is NOT implemented

The SDK-powered prepareEnvelope callback is an integration contract, **not a finished assembler/verifier**. Canonical base64 is **not** XDR structural validation, signature verification or a demonstration that the taker auth was attached correctly. A malicious adapter can fabricate valid-looking responses. This guard MUST NOT be connected to live execution or used to justify unpausing M9.

A separately reviewed SDK/Freighter integration must:

1. Simulate exact M9 settle(MatchTerms) on Stellar Testnet with correct deployed code, maker/taker, both approved XLM and USDC SACs, seven-decimal amounts, limit prices, distinct match/order IDs, fresh expiry and bounded fee.
2. Require exactly one non-source Soroban auth signer (taker), decode and verify its credential address, invocation tree, nonce, expiration and signature for the expected simulation.
3. Attach the verified signed taker auth entry to that same original simulated transaction **before** maker signing. Validate that the final envelope source is maker, includes only the expected M9 call, has correct contract/assets/amounts/network, and that the source signature is valid.
4. Fail closed on stale ledgers, replay, unexpected operations or auth, changed wallet/network, missing funds, or excessive fee. Never request or export private keys or recovery phrases.
5. Design and independently review a **separate** explicit-consent, Testnet-only broadcast gate. Confirm on-chain SUCCESS, M9 receipt(match_id), is_settled(match_id), correct before/after balances, and replay rejection before claiming a genuine transaction. Self-owned Testnet wallet checks are internal, not independent user traction.

## Remaining launch boundary

M41 has independently verified M9 deployment, approved XLM/USDC, and two funded wallets. **M9 remains paused**. This PR never invokes set_pause(false), settle or any network broadcast. Perps, lending, unified margin, public trading and mainnet stay disabled.

Run npm run test:m43 for focused tests, or npm test for the repository suite. Passing tests do not establish real Freighter integration or trading readiness.

See [M41](m41-live-spot-token-handoff.md) and [M9 operator reference](m9-wallet-operator.md).
