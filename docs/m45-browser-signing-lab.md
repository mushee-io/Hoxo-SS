# M45 — Controlled two-wallet Testnet signing lab (NO BROADCAST)

**Status: implementation on draft PR #34, not a live trading launch. M9 remains paused.**

## Terminal access

On a **built copy** of this branch, visit /app and scroll below the disabled Buy/Sell ticket to the **M45 · TWO-WALLET SIGNING LAB** section. This is a separate internal-signing review screen, never an order-execution panel. The normal Buy/Sell button is still disabled for all markets.

Browser dependency supply: pinned @stellar/stellar-sdk 17.4.0 bundled **locally**, using esbuild 0.25.12. Run npm install and npm run build:m45 before serving. The generated app/m45-spot.bundle.js must be built before publishing the preview; it is not fetched from an untrusted SDK CDN. The existing Freighter script is unchanged.

## Operator checklist

1. **Verify live Stellar Testnet.** The read-only RPC/Horizon probe checks exact Testnet network passphrase, recent/matching ledger states (<=24-ledger difference, Horizon <=120 seconds old), M9 deployment and WASM SHA-256, expected Wallet 1 administrator, XLM and Circle Testnet USDC SAC identity and decimals, paused/allowed flags, both wallet balances and authorized USDC trustlines.
2. **Review a manually agreed bilateral price and amounts.** Enter test XLM and USDC quantities (e.g., 0.0100000 XLM / 0.0200000 test USDC). This is **not** a market quote, listing or oracle. Tick the acknowledgement. If M9 is still paused, step 2 stays disabled. After a separate authorized unpause, a future acceptance test can use a fresh read-only preflight, unique cryptographically random 32-byte IDs, an exact M9 settle simulation and a short ledger expiry.
3. **Wallet 2 approval (non-source).** An independent confirmation checkbox and click would call Freighter signAuthEntry and cryptographically verify exact Soroban invocation, credential address, nonce, expiration and Ed25519 signature.
4. **Wallet 1 approval (source).** A second independent confirmation checkbox and click would attach the verified Wallet 2 authorization and request Freighter signTransaction with submit:false, verifying the exact source envelope and Ed25519 signature.
5. **Clear the review.** The screen can reset its in-memory session. No secrets or signed XDR are stored in files, analytics, cookies or browser storage.

All completion states report broadcast:false, executionPermitted:false, no transaction hash and confirmed volume zero. The UI never invokes sendTransaction or set_pause(false).

## Explicit blockers

- Deployed M9 remains **paused**. That is an intentional safety stop: M45 can check live data now, but its signing buttons cannot enable while pause=true, and a settle simulation cannot succeed in that state.
- This branch has no authorized Testnet broadcast gate, no independent security audit and no end-to-end real wallet-signed settlement proof.
- Browser UI code uses the reviewed M43–M44 adapter and XDR verifier behind a fresh RPC preflight, but device-specific interactive Freighter testing on Windows is still outstanding. Automated signature tests use actual Stellar SDK-generated XDR and test keypairs, not wallet owner's secret keys.
- A successful mock simulation, unit test or healthy network cannot be counted as executed trading. Trades between two wallets under the same ownership are **internal checks**, not independent user traction or actual exchange demand.
- No perp, margin, money-market, mainnet or public beta execution is enabled by this milestone.

## Engineering verification

- npm run test:m45 — preflight trust/ledger/paused checks, manual numeric terms and fail-closed signing.
- npm test — entire JS regression suite, including M43/M44.
- npm run build:m45 — pinned local browser bundle.
- Chromium smoke checks verify the visible M45 panel, disabled normal ticket, and no wallet prompts when the read-only preflight is unavailable.

## Follow-on acceptance milestone

Independent source/XDR security review and funded Windows Freighter hardware/browser testing; inspect fresh simulation and both approvals. Only after passing those checks should the contract administrator authorize a separately reviewed controlled Testnet unpause, followed by a genuine small wallet-signed M9 spot swap and independently reconciled on-chain receipt/balance changes. This is not yet public trading.
