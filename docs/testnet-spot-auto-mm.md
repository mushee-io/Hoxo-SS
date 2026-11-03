# Hoxo Stellar Testnet — automatic XLM/USDC market maker

## Status and venue

This is an **actual Stellar Testnet Classic DEX** market maker. It posts **real signed** Stellar Classic DEX `manageSellOffer` bids and asks with valueless Testnet XLM and Circle Testnet USDC, not internal Hoxo M9 matches and not fake volume. Traders using Hoxo's M63 Classic DEX route can take the offers by approving an atomic wallet transaction. Only actual independent network receipts can count as trades. No self-matching, no manufactured traction and no mainnet transactions.

**Default: DISARMED.** CI and the read-only planner work without a secret key. Live 5-minute automatic refresh starts only when the GitHub Actions repository variable `HOXO_MM_LIVE` is set to the exact value `YES` **and** an operator configures a funded signing wallet. No wallet keys are requested through ChatGPT.

## Your funded wallet

You already have Testnet XLM + USDC; no new faucet funding is needed **provided** that you have enough spendable tokens after Stellar reserves and an authorised trustline for issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. Use a dedicated Testnet wallet for unattended signing; avoid using a wallet containing mainnet value or other projects' credentials. A wallet address alone cannot sign repeated automatic transactions; Freighter's interactive approval is designed for manual transactions.

**Do not paste a secret or recovery phrase into the repo, chat, PR, issue, logs or workflow inputs.** If opting for GitHub-hosted unattended signing, its Actions Secrets storage grants the runner temporary signing access; a dedicated, low-balance Testnet key limits exposure. Alternatively, run the same command on your own Windows computer with a temporary local environment variable, not a persistent plaintext key.

## Default conservative settings

| Control | Default | Behaviour |
|---|---:|---|
| Spread | 200 basis points (2% total) | Half-spread each side of an independently retrieved public XLM/USD reference |
| Size | 5 XLM per side | Bid and ask separately bounded by spendable balances |
| Quote notional | 2 Testnet USDC per side | Hard maximum per quoted side |
| Interval | 5 minutes | Existing bot offers atomically cancelled and refreshed |
| Price safety | 30-second reference maximum | Wrong network, stale/missing reference, crossed book or >25% distortion stops quoting |
| Reserve | 1 XLM + account reserve buffer | Rest of native XLM is protected from asking |
| USDC reserve | 1 Testnet USDC | Protected from bidding |
| External reference | Public Kraken XLM/USD ticker | Used only for quoting; NOT presented as Hoxo on-chain market data and not an oracle for perps |
| Mainnet | Never | Hardcoded Stellar Testnet Horizon and `Networks.TESTNET` |

The external public XLM/USD ticker is only a reference; it cannot guarantee a specific Testnet USDC price. Each posted offer is a limit, not a market order. The bot will not deliberately cross the existing best bids/asks. Other market participants may execute against these real offers; that is genuine Testnet activity but **not** a Hoxo M9 contract fill.

## Activate unattended Testnet quoting in GitHub

1. Open **GitHub → mushee-io/Hoxo-SS → Settings → Secrets and variables → Actions**.
2. Under **Variables**, add `HOXO_MM_PUBLIC_KEY` with the dedicated maker account's **public G-address**. Keep `HOXO_MM_LIVE` unset or `NO` while testing. Optional: `HOXO_MM_SIZE_XLM=5`, `HOXO_MM_SPREAD_BPS=200`, `HOXO_MM_MAX_USDC=2`.
3. Under **Secrets**, add `HOXO_MM_SECRET` with **only** the dedicated, valueless Stellar Testnet maker account's signing seed. Never share it with an assistant. Use the smallest necessary wallet inventory; GitHub-hosted runners will briefly have signing access.
4. Go to **Actions → Hoxo Testnet XLM/USDC Automatic Market Maker → Run workflow → mode = plan**. It should print `PLAN_ONLY`, the correct wallet G-address, spread and inventory-bounded offers. This mode cannot sign or submit.
5. After checking the preview, set **Variables → `HOXO_MM_LIVE=YES`** and run workflow with **mode = live**. It will place real Stellar Testnet offers, independently verify the returned hash and ledger, and then refresh about every five minutes. Every workflow execution runs the maker tests before accessing the live transaction step.
6. View the last workflow's confirmation hash on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet). A successful offer-creation transaction is **not** a filled trade; actual fills require independent counterparties.

To **stop**, first change `HOXO_MM_LIVE` back to `NO` (disarms scheduled renewals). Then run the workflow manually with **mode = stop**, which cancels bot-owned XLM/USDC offers even while disarmed. Wait for an independently confirmed cancellation hash before assuming the book is empty.

## Running locally on Windows

Install Node.js 22+ and dependencies. From the project folder:

```powershell
npm install --ignore-scripts --no-package-lock
$env:HOXO_MM_PUBLIC_KEY = "YOUR_PUBLIC_TESTNET_G_ADDRESS"
node scripts/run-testnet-mm.mjs plan
```

For actual continuous posting, the script also needs `HOXO_MM_SECRET` (read from the local environment) and `HOXO_MM_LIVE=YES`. Do not save the seed in your PowerShell history, repository, batch file or `.env`. If you cannot securely provide a local environment variable, use a dedicated Testnet-only key in GitHub Secrets via the user-facing form.

## Operational fail-safes and limitations

- Every run independently verifies the Testnet network passphrase, pinned USDC issuer, balances, current bot offers, public price and current order book.
- Each refresh cancels its prior two offers **in the same Stellar transaction** and creates replacement bids and asks. It does not alter anyone else's offers and refuses to touch a wallet with unrelated orders.
- Network price failure triggers **cancellation** of existing two offers if signing is available. If Horizon itself is unavailable, the runner cannot confirm cancellation; verify the last successful action on the explorer and run **stop** once available.
- No auto-trading is enabled for XLM-PERP. No maker keys are ever required by the Hoxo public frontend.
- This is a Testnet bot, not a public mainnet market-making service. Exchange inventory, issuer policies, Horizon availability, transaction fees and order matching can change; inspect receipts and do not claim a filled trade without verified settlement.
