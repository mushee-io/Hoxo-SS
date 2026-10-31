# M1 — Stellar Testnet landing page

This is a **read-only testnet-aware front door**, not an operational exchange. Implementation lives in `index.html`, `assets/site.css`, `assets/landing.mjs`, and `assets/testnet-status.mjs`.

## Acceptance
- Desktop and mobile layouts retain the HOXO SS brand and offer explicit access to `/app/`.
- Mobile navigation can be opened by button, closed by Escape or by following a link, and exposes `aria-expanded`.
- Horizon root is fetched directly from **https://horizon-testnet.stellar.org/** and verifies exact **Test SDF Network ; September 2015** passphrase plus a ledger closed within the past two minutes. Missing, stale, wrong-network, HTTP error, timeout or browser CORS failure produce an explicit unavailable/warning state.
- The display distinguishes **network connectivity** from **exchange contract readiness**. No wallet signing, deposits, orders or borrowing are permitted on the landing page.
- `npm test` must pass M0 and M1 unit/smoke tests; real hosted mobile/desktop visual verification and Horizon browser connectivity remain separate acceptance checks.

## Manual testnet verification
1. Open the deployed **preview** landing page; confirm the network status reads `TESTNET VERIFIED` only when Stellar Testnet Horizon returns its expected passphrase and current ledger.
2. Temporarily disconnect network access; refresh the status and verify it becomes `STATUS UNAVAILABLE`, not an optimistic green indicator.
3. Follow **LAUNCH TESTNET TERMINAL** to `/app/`. Confirm buying, selling, contract deposits and withdrawals stay disabled until the associated contracts have been deployed and audited.
4. At 375px, 768px and 1440px, check navigation, hero layout, keyboard focus, and no horizontal overflow.
5. Test Freighter and Friendbot separately under **M3/M4**; they are not acceptance evidence for M1.

**Testnet policy:** mainnet passphrase is rejected; no testnet ledger activity is represented as genuine trading volume or liquidity.
