# Milestone 3 — Freighter + verified Stellar Testnet wallet

## Scope

M3 implements **read-only wallet identity and holdings** for the static trading terminal. A real Freighter browser extension approves the connection; the application requests **public account address only**, never private keys. Network passphrase `Test SDF Network ; September 2015` is required.

The code is designed for Stellar Testnet. It does **not** make deposits, orders, smart-contract calls, sign transactions, or show collateral positions. Stellar Testnet wallet balances are not margin collateral.

## Features

- Freighter v6.0.1 CDN integration from the wallet's documented static-page API.
- Detect extension with `isConnected()`, request approval with `requestAccess()`, then cross-check `getAddress()` and `getNetwork()` against the expected Testnet network.
- Validate classic Stellar `G...` StrKey checksum and type, reject network mismatch, uninstalled extension, stale ledger, account mismatch and malformed Horizon balance responses.
- Query only **https://horizon-testnet.stellar.org/** and only after validating its passphrase and most recent closed ledger. Fetch account balances from verified Horizon, including token issuer identity. A missing account is reported as *unfunded* instead of *offline*.
- Refresh via explicit button, window focus/visibility and 30-second check. A network/account change clears the session and holdings. Disconnect clears local state; no browser localStorage/sessionStorage caching.
- Copy public address and open its Testnet explorer page. Friendbot funding requires explicit user confirmation, an unfunded account, and revalidation before requesting valueless XLM.
- Friendbot response is followed by a fresh Horizon check; a funding request is not presented as successful until the account is confirmed.
- All existing **trade/deposit/withdrawal** buttons remain disabled.

## Verification gates

- Run `npm test` for unit tests: valid/invalid Stellar StrKeys, network switching, malformed/stale Horizon replies, account identity, wallet authorization denial, funded/unfunded states and faucet restrictions.
- M3 browser smoke tests should verify Freighter-compatible wallet API mocks and real UI behaviour. Mocking the extension alone is **not** a genuine Freighter wallet test.
- Manual acceptance: on an authorised hosted preview, install real Freighter, switch to Testnet, request access, fund a test account, confirm actual Horizon balances and test account/network switch rejection.
- Hosting still blocked by Vercel project-creation HTTP 403, so **live extension/hosted acceptance is pending**.

## Security limits

- No seed phrase, secret key, signed message, or spending authorisation requested.
- The quoted/visible token balance is a *wallet holding*, not spendable balance after Stellar reserves; nothing is represented as withdrawable collateral.
- No asset claim is inferred from the reference-market catalog; any USDC/BTC/ETH balances are shown only if present in the actual account response with issuer details.
- Mobile Freighter via WalletConnect is outside the desktop-extension M3 implementation; do not label mobile wallets supported without that integration.
