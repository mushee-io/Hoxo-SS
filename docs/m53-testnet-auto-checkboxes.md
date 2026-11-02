# M53 — Automatically checked Stellar Testnet trading acceptance

## What this actually checks

Run `npm run check:testnet-trading`. This is **READ ONLY** and reads the current M9 settlement contract and both public funded Stellar Testnet wallets using the already-reviewed M41 RPC + Horizon verification. It produces:

- `testnet-checklist-report/testnet-trading.md` — a checkbox report in which `[x]` means verified by live on-chain evidence, `[ ]` means blocked, unverified or pending.
- `testnet-checklist-report/testnet-trading.json` — machine-readable values and reasons for 20 precise spot/perpetual acceptance gates.

Run `npm run test:m53` for deterministic negative/adversarial checks. The dedicated `.github/workflows/m53-testnet-trading.yml` runs automatically when this branch's PR changes the relevant files and uploads both files as a GitHub Actions artifact.

**IMPORTANT:** A successful GitHub Actions run proves the **evidence checker works**. It does **not** claim that spot/perp trading is live, or that all checkboxes have passed. A live Testnet check can pass as a workflow while individual milestones remain BLOCKED or PENDING.

## Readiness checklist contract

The evaluator only automatically ticks concrete current M41 on-chain observations:

1. Canonical Stellar Testnet RPC and fixed wallet/asset identity
2. Exact reviewed M9 deployed WASM SHA256 + owner
3. XLM/USDC Soroban allowlists
4. Wallet 1 XLM reserve
5. Wallet 1 exact Circle Testnet USDC trustline and nonzero balance
6. Wallet 2 XLM reserve
7. Wallet 2 exact Circle Testnet USDC trustline and nonzero balance
8. M9 paused=false (when and only when independently observed). **An unpaused contract does not itself authorise trading.**

Everything else stays unchecked until stronger evidence exists: actual 2-wallet Freighter approvals, each-direction independently verified XLM spot settlement receipts and wallet balance changes, real Hoxo orderbook matching, verified on-chain perpetual clearinghouse and oracle/risk/unified-margin, isolated deposited perpetual margin, real on-chain price/solvency/liquidation proof and each-direction genuine XLM-perp position receipts.

This preserves the separation between **protocol source code, passing unit tests, genuine deployment, actual wallet signatures and on-chain settlement evidence**.

## Continuous checking and no-deployment rule

This GitHub branch/PR is NOT merged. The existing **Hoxo-SS Testnet Build** hourly ChatGPT automation monitors GitHub CI, reads M41 proof and the M53 checklist and makes safe GitHub-only progress. The `workflow_dispatch` entry permits another run after operator review. **GitHub `schedule` does not execute for an unmerged branch** and should not be represented as an active hourly GitHub Action until the workflow is in the default branch. The active hourly ChatGPT task is separate.

No signing, XDR creation, fee approval, nonce issuance, private-key request, synthetic orderbook, contract unpause or transaction submission is implemented in M53. No Vercel deploy, main merge, mainnet activity or false volume.

For real **spot BUY/SELL** development see draft [PR #34](https://github.com/mushee-io/Hoxo-SS/pull/34); for **perp LONG/SHORT** and actual Soroban M12 unsigned open see draft [PR #39](https://github.com/mushee-io/Hoxo-SS/pull/39); for the more polished market terminal see [PR #37](https://github.com/mushee-io/Hoxo-SS/pull/37).

**Nothing is automatically approved for spending.** The user signs with their own Freighter wallet and authorises each controlled, valueless Testnet transaction when the separate reviewed execution acceptance is ready.
