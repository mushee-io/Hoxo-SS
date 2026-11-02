# M46 — Windows Freighter acceptance and controlled release gates

**Branch:** PR #34 (Draft), continuing M43–M45. **Execution disabled; M9 remains paused.** M46 does not request a wallet signature, submit transactions, deploy, unpause M9 or enable trading.

## Two-wallet Windows verification (read only)

On a preview of this branch after CI's pinned SDK/browser build and a Vercel READY deployment matching the *current* GitHub head SHA, open /app?market=xlm-usdc-spot. The M46 Windows Wallet Acceptance panel appears after M45.

1. Use Chrome or Edge with the official Freighter extension installed. Switch to Stellar Testnet. Never input or export secrets or recovery phrases.
2. Tick the Windows/Testnet acknowledgement. Select Wallet 1 in Freighter and click Verify Wallet 1. M46 calls only Freighter getNetwork and getAddress, plus live read-only public Stellar RPC/Horizon checks. It verifies selected public address, ledger freshness, expected deployed M9 WASM/owner, paused contract state, approved assets and authorized funded wallet trustlines.
3. Switch Freighter to Wallet 2 and click Verify Wallet 2. Repeat the read-only checks. Wrong account, wrong network, stale ledger, unauthorised trustline or changed deployment clears earlier acceptance and rejects.
4. Both Wallets Verified — No Trades appears only when both manual checks are fresh (maximum 120 seconds apart) and the second proof's ledger is not earlier than the first or more than 24 ledgers ahead. A ledger regression or excessive drift clears both reviews; restart from Wallet 1. This is not permission to sign, unpause or submit any transaction.
5. Clear Windows Acceptance Session resets this in-memory state. No secrets, signed XDR or account details are persisted or uploaded.

## Separate release and activation gates

- GitHub: code review, passing Node and Chromium tests, pinned local SDK/esbuild browser bundle, all necessary source files on PR #34; retain Draft status during acceptance.
- Vercel: READY deployment **for the exact current PR head SHA**, correct build command, functioning /app route and visible M45/M46. An earlier READY deployment is not current. On build rate-limit, defer; do not force production promotion.
- Windows operator: real Freighter device test with both accounts, no auto signature prompts or private-key exports. Mock browser CI alone cannot establish this acceptance.
- Security: independent contract and signing review, bounded fees/amounts, fresh simulation and expiration, replay rejection, explicit admin approval. Keep M9 paused until these pass. CI passing is not an external audit.
- First settlement: separately authorize a small test-only trade, confirm genuine Testnet SUCCESS, M9 receipt and is_settled state, verify before/after wallet balances and independent on-chain evidence. No such evidence is currently established.
- Public beta: disabled until completed signed settlement and independent security/risk governance. Operator-owned wallets are internal tests, not outside traction.

M46 is deliberately not an unlock mechanism for M45 signing or trading. It enables read-only Windows QA while the M9 safety pause remains active.

## Developer commands

- npm run test:m46 — read-only wallet identity, wrong-network, stale and pause-failure regression
- npm test — full Node regression suite
- npm run build:m45 — bundles M45 plus M46 with pinned SDK, without an SDK CDN
- Chromium CI — verifies both UI panels fail closed without live Freighter or Testnet RPC

**Do not merge or promote PR #34 simply because Vercel resumes; deployment is not trading authorization.**
