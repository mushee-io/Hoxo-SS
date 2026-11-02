# M51/M52 — Real XLM Spot Buy/Sell signing and guarded Testnet settlement

**Implementation branch:** Draft PR #34 (`m43-browser-dual-wallet-auth-guard`). **Do not merge to main or deploy/promote Vercel while the operator is away.**

## M51 — Both trade directions, same M9 Soroban contract

The existing M45 lab is extended with a deliberate Wallet 1 **SELL XLM** or **BUY XLM** selection:

| Wallet 1 side | Maker/source Wallet 1 | Taker/auth Wallet 2 | M9 `maker_side` |
|---|---|---|---|
| SELL XLM | Sends XLM; receives Testnet USDC | Pays USDC; receives XLM | 0 |
| BUY XLM | Pays Testnet USDC; receives XLM | Sends XLM; receives USDC | 1 |

The SDK creates exact seven-decimal `MatchTerms`, unique random match/order IDs, user-input bilateral price bounds, a short current-ledger expiry, and a one-operation Soroban `settle` simulation. For either side, source **Wallet 1** signs the transaction envelope through Freighter, while non-source **Wallet 2** signs the Soroban authorization entry. No seed/private-key import.

The updated preflight checks the **correct asset owner** for each side: the XLM seller needs the full XLM amount and a native reserve; the USDC payer must hold the exact approved Circle Testnet USDC trustline/amount. Every change of side or amount invalidates previous simulated terms and signature state.

## M52 — Real transaction submission and verified finality (implemented, NOT activated)

`app/m52-testnet-spot-finality.mjs` introduces an **isolated, opt-in engine**, not wired to the default order ticket:

- Re-read canonical Testnet passphrase, deployed M9 WASM hash, exact Wallet 1/Wallet 2 identities, token allowlists, fee/reserve and **M9 paused=false** before any signing/send step.
- Validate every exact input, max initial trade **0.1 test XLM / 1 test USDC**, expiry within the Testnet ledger bounds and fee <=1,000,000 stroops.
- Cryptographically verify Wallet 2 signed Soroban auth entry, **independently rebuild and compare the exact resulting envelope**, and verify Wallet 1's detached source signature over the identical XDR.
- Default `send=false`: produce `REVIEWED_ONLY`, never transmit. Actual submission requires explicit `SEND_SMALL_HOXO_STELLAR_TESTNET_SPOT` acknowledgement **in addition** to both Freighter approvals.
- Before send, query M9's replay marker and paused state again. Only send exact confirmed XDR with the official Stellar SDK. Poll genuine network finality, match all signed receipt terms, read `is_settled`, reconcile both wallets' post-settlement USDC/XLM token balances with bounded maker-paid gas, and only then report a confirmed Testnet settlement.
- Never auto-unpause, infer approval, write private keys, execute mainnet trades, produce artificial volume or mark unsigned previews as fills.

**Not operational yet:** the live M9 Testnet contract is currently **paused**. The M45 signing lab intentionally blocks simulation while paused. The M52 engine is **not yet wired to an enabled Buy/Sell control**; its security integration and manual operator acceptance require further review and tests before it may be deployed. No on-chain trade or receipt is claimed from this branch.

## Perpetuals in separate Draft PR #39

Real bilateral XLM-PERP long/short terms and exact unsigned M12 `open` XDR are now engineered behind strict, independently verified Stellar Testnet M5 oracle, M7 risk, M12 perp clearinghouse and M15 unified-margin contract deployment/solvency/collateral guards. The registry still marks these as **planned**, so the preflight fails closed. An external Hyperliquid depth feed cannot replace authenticated Soroban risk and settlement.

## Required before live Testnet Buy/Sell

1. Review/accept M43–M52 XDR, signature, ledger-expiry and duplicate-auth-entry tests, independent security review and operator-approved M9 unpause.
2. Validate with real **Freighter Wallet 1 + Wallet 2** on Windows, each explicitly signing their distinct role after the on-chain preflight passes.
3. Execute **one** controlled valueless Testnet XLM/USDC transaction, verify RPC SUCCESS, M9 exact receipt, replay marker and independent token deltas.
4. Only then integrate signed settlement into the standard Buy/Sell ticket behind explicit permissions; keep public beta closed until broader risk/security testing.
5. For perps, separately deploy, audit, verify and fund both counterparties' margin and oracle/risk controllers, then execute one signed M12 long/short position and verify independent receipt.

Test commands: `npm run test:m52`, `npm test` on Draft PR #34, plus M51 perp checks from PR #39.

**NO VERCEL, NO PRODUCTION PROMOTION, NO MAINNET, NO AUTOMATIC M9 UNPAUSE.**

## M52 receipt type integrity

Receipt verification now requires the M9 `maker_side` to be the exact numeric side (0 or 1) and `settled_ledger` to be a positive safe integer, rather than accepting strings or fractional/coerced values. Regression cases cover string side, null side, string ledger, fractional ledger and unsafe ledger values. These are validation safeguards only; no settlement receipt has been observed or submitted by this change.

## M52 exact signed-envelope transaction-hash binding (2 November)

The RPC submission response must report the SHA-256 transaction hash computed by the official Stellar SDK from the **exact already-verified signed transaction envelope**. A well-formed but different RPC hash fails closed **before** polling finality or accepting a receipt. This prevents accidentally attributing another transaction's SUCCESS to the approved two-party spot settlement. Tests cover the matching canonical hash, uppercase hex, malformed lengths, invalid types and substituted hashes. This check does not itself establish a signed on-chain trade; user-controlled authorization and independent balance/receipt checks remain mandatory.

**Operational note:** The earlier documentation describing M9 as paused is historical. A separate read-only M41 rerun on 2026-11-02 at ~11:13 UTC reported M9 unpaused with XLM/USDC enabled; revalidate the current ledger before any approved send. No automatic unpause or send is performed here.
