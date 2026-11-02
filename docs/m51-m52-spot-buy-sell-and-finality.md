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

**Current verified Testnet status (2 November 2026):** M9 is **UNPAUSED** following the operator's Freighter-admin transaction; live M41 code/owner/asset/wallet verification confirms the change. The M55 live RPC workflow has now independently simulated BOTH XLM BUY and SELL on the actual M9 contract. This is not proof of any on-chain settlement; both wallet approvals and final submit remain required. The guarded M52 submission module is now connected through M45/M55 as an **explicit user-clicked final action**, with exact typed consent, tight initial limits and genuine receipt/balance checks. It is only on this GitHub draft branch, NOT deployed to Vercel or publicly activated.

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

## M55 — Small-amount, operator-controlled test in a local Windows browser

Engineering now links the spot ticket to the reviewed M45/M51/M52 bilateral signing lab. The general market order button remains disabled until native matching and live financial beta approval exist. This internal acceptance flow is specifically designed to exercise **one manually agreed two-wallet spot delivery-versus-payment** on Stellar Testnet.

Once the branch passes full CI, an operator may test it locally **without a Vercel deployment**:

1. Check out `m43-browser-dual-wallet-auth-guard`, install Node.js 22+ and Python 3, run `npm install` and `npm run build:m45`.
2. From the repository root run `python -m http.server 4173 --bind 127.0.0.1` and open `http://localhost:4173/app/?market=xlm-usdc-spot` on the Windows computer with the official Freighter extension.
3. Click **OPEN SMALL TESTNET SPOT BUY/SELL**. Select Wallet 1 **BUY** or **SELL**. Review the manually agreed Testnet amounts (default 0.0100000 XLM / 0.0017000 Testnet USDC), check the current Testnet network, contract WASM hash, admin, pause, trustlines and funded wallets.
4. Click **SIMULATE EXACT SOROBAN TERMS** after acknowledging manual terms. Review the exact match ID, side, 7-decimal amounts, expiry and fee. The RPC sim is read-only. Keep wallet approvals inside the short 20-ledger expiry; restart if expired.
5. Switch Freighter to **Wallet 2**, explicitly approve the non-source Soroban authorization. Switch to **Wallet 1**, explicitly approve the transaction envelope (Freighter `submit:false`).
6. Only after checking the exact transaction and fee again, tick the **final send consent** checkbox, type exactly `SEND_SMALL_HOXO_STELLAR_TESTNET_SPOT`, and click **SEND SIGNED TRANSACTION · STELLAR TESTNET**. This is the *only* code path in M55 that can call the reviewed M52 `sendTransaction` method.
7. The UI only shows **SETTLED** and links to Stellar Expert after RPC `SUCCESS`, the matching M9 receipt, the on-chain replay marker and exact two-wallet XLM/USDC balance reconciliation. If RPC finality is uncertain, **do not retry blindly**; inspect the transaction hash and current account balances first.

The exact two-wallet signature handoff cannot be completed unattended: only the owner of each selected Freighter wallet can approve it. No private keys or recovery phrases should ever be provided in chat or stored in a server.

### Independently verified simulation evidence

GitHub run [M55 live Testnet simulation](https://github.com/mushee-io/Hoxo-SS/actions/runs/41463010912) reports genuine contract simulation success for BOTH sides at ledger **5,521,271**, using `0.0100000 XLM / 0.0017000 USDC` with estimated transaction fee **220,712 stroops**, while explicitly reporting `transactionsBroadcast:0` and `verifiedOnChainFills:0`. Test mock signatures/receipts are never presented as genuine trading activity. A later run must check the latest contract pause/ledger again before signing.

**Release control remains GitHub-only: no merge into main and no Vercel promotion without the operator's approval.**


## M52 receipt type integrity

Receipt verification now requires the M9 `maker_side` to be the exact numeric side (0 or 1) and `settled_ledger` to be a positive safe integer, rather than accepting strings or fractional/coerced values. Regression cases cover string side, null side, string ledger, fractional ledger and unsafe ledger values. These are validation safeguards only; no settlement receipt has been observed or submitted by this change.

## M52 exact signed-envelope transaction-hash binding (2 November)

The RPC submission response must report the SHA-256 transaction hash computed by the official Stellar SDK from the **exact already-verified signed transaction envelope**. A well-formed but different RPC hash fails closed **before** polling finality or accepting a receipt. This prevents accidentally attributing another transaction's SUCCESS to the approved two-party spot settlement. Tests cover the matching canonical hash, uppercase hex, malformed lengths, invalid types and substituted hashes. This check does not itself establish a signed on-chain trade; user-controlled authorization and independent balance/receipt checks remain mandatory.

**Operational note:** The earlier documentation describing M9 as paused is historical. A separate read-only M41 rerun on 2026-11-02 at ~11:13 UTC reported M9 unpaused with XLM/USDC enabled; revalidate the current ledger before any approved send. No automatic unpause or send is performed here.


### M52 parser and finality regression (2026-11-02)

The exact signed-envelope hash must be compared with the RPC submission hash before finality polling; the poller receives only the verified canonical hash. A source-level regression test now checks this invocation and guards against an accidentally escaped `\\n` token in the module. This correction is **code-only**, does not authorize submission, and requires passing GitHub CI before review or merge. The existing separate operator acknowledgement and independent Testnet safety checks remain mandatory.

### M52 receipt amount type boundary (2026-11-02)

Read-only M9 settlement receipt verification now requires `base_amount` and `quote_amount` to be canonical decimal **strings** exactly equal to the reviewed terms. Numeric, BigInt, and object-coercible representations are rejected rather than silently converted with `String(...)`. This prevents untrusted RPC adapter output from passing through JavaScript coercion. The regression suite includes matching-looking numeric, BigInt and custom `toString` values. This is a validation hardening change only; it is not evidence of an executed Testnet trade. The dual-wallet signature, explicit send acknowledgement, replay, balance and finality gates remain mandatory; do not enable unattended submission or production release.
