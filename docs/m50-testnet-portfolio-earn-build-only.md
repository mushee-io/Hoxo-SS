# M50: Hoxo Testnet Portfolio, Earn foundations and MIT licence

## Scope and deployment hold

This branch is **GitHub development only**. Leave it as a draft PR for review when the operator returns. Do **not** merge to `main`, deploy/promote with Vercel, change `hoxo.mushee.xyz`, unpause Soroban contracts or publish this functionality as live yet.

GitHub source code may be automatically preview-built by third-party CI integrations, but no Vercel deployment API action is requested by this milestone.

The repository now contains an official `LICENSE` file with the standard **MIT License** and `Copyright (c) 2026 Mushee`. The root of the repository will advertise the MIT licence to GitHub only **after the branch is merged**.

## Portfolio — real Testnet account data

- Connect a Freighter public G-address on **Stellar Testnet**. No keys, recovery phrases or signed XDR are collected.
- The main Portfolio page reads a recent **verified Horizon Testnet network root**, exact account identity and real wallet balances. It fetches the latest 20 wallet-owned **classic Stellar DEX offers** (`GET /accounts/{G}/offers`) and **classic Stellar account trades** (`GET /accounts/{G}/trades`).
- The existing Trade → Open Orders and Trade History tabs can now inspect these same independently observed **classic DEX** records rather than falsely presenting actual on-chain public offers/trades as unavailable. **Hoxo M9 offers, matching, perps, settlement receipts and PnL remain unverified**. Classic DEX records are not relabelled as Hoxo volume or users.
- Strict response parsing rejects other-owner records, malformed asset issuers, duplicate IDs, invalid amounts, impossible timestamps (including pre-Stellar-network dates), wrong Testnet network and future ledger numbers. Never follow Horizon response-provided `next` links; fixed own endpoints only.
- Account selection and wallet refresh invalidate previous public portfolio data. Failed network reads display an error rather than cached/current-looking data.

## Earn — conservative functional preview

- The Earn section displays the connected wallet's observed Testnet XLM / Circle Testnet USDC balances, pool deployment registry status and clear unavailable flags for deposits, withdrawals, borrowing and repayment.
- An **unsigned amount review** checks the exact desired asset, issuer, seven-decimal units and amount against the wallet-held balance (not spendable funds). It does NOT create a lending transaction or present any pool shares, rates, APY, TVL or credit capacity.
- The Soroban `contracts/money-market` source contains pool/share/debt/rate code and remains a workstream for actual deployment, testnet transactions, risk-authority integration and security review. A source file or registry entry alone does not prove a live pool. Existing registry/testnet.json still marks the money-market contract planned.
- There is deliberately no transaction signing, wallet permission escalation, on-chain deposit, borrow or repayment method in this UI.

## Outstanding milestones for independently verified Testnet finance

1. Reconcile independently verified M9 deployed WASM, contract ID, admin and pause evidence with the stale planned-only registry **without pretending M9 is active**.
2. Complete actual reviewed maker/taker Freighter authorization, current-ledger Soroban simulation and cryptographic envelope verification; retain a separate operator-controlled approval/unpause gate.
3. Execute a small valueless wallet-signed XLM/USDC spot settlement only with explicit wallet owner approval and independently reconcile M9 receipts and both balance deltas.
4. Deploy and independently verify Stellar Testnet money-market / vault / risk contracts, check source code hashes, risk-authority binding and contract-asset identity, then exercise real signed supply/borrow/repay/withdraw through an audited and bounded system.
5. Deploy and verify the perps clearinghouse, oracle freshness, pricing, cross-product solvency, liquidation and unified margin before allowing genuine perp orders.
6. Require independent security review and real user acceptance before enabling public beta and eventual mainnet.

**No mainnet assets, fake APR, fabricated market fills, self-trades, fake user count, private keys or automated fund movements.** The GitHub hourly engineering automation works incrementally on these blockers, producing code/CI and precise acceptance status. It cannot access the user's Freighter private signing authority.

## Engineering verification

`npm run test:m50`, `npm test`, and `npm run test:browser` (Chromium installed in GitHub Actions). The latest automatic tests use an isolated mocked network and simulated wallet API. Those tests do NOT verify live E2E signed settlement.
