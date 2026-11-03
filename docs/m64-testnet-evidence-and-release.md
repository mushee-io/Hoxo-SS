# M64 — Testnet evidence and release boundaries

This document records the acceptance boundary, not a declaration of live trading.

## Independently verified historical evidence (2026-11-02)

- M9 Stellar **Testnet** contract: `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF`.
- [M41 read-only contract proof](https://github.com/mushee-io/Hoxo-SS/actions/runs/41432398294) reported verified WASM hash and owner, `contractPaused:false`, and XLM/USDC allowlists true. Do not interpret the older M41 `paused:true` snapshot as current.
- [M55 CI](https://github.com/mushee-io/Hoxo-SS/actions/runs/41463848479) simulated both XLM/USDC directions against Testnet RPC without broadcasting.
- [M59 production commit](https://github.com/mushee-io/Hoxo-SS/commit/e9d4f7630cbd894c963a0937aff41b374b851281) shipped the spot UI and read-only ledger activity endpoint. Website deployment does not prove financial execution.
- The latest previously observed M9 event feed at ledger 5523850 had **zero verified Hoxo spot settlements and zero verified volume**. This is a dated observation, not a live claim. Re-query `/api/hoxo-testnet-activity` and validate genuine transaction hashes before updating.

## Execution acceptance — keep these separate

1. **Spot:** require two distinct consenting Testnet wallets, independent quote and balance preflight, user-controlled Freighter authorization, user-controlled broadcast, successful transaction receipt, token-balance reconciliation, and indexed M9 event proof for both BUY and SELL. A successful simulation alone is insufficient.
2. **Lending:** require independently verified contract deployments and bindings, signed deposit/borrow/repay/withdraw receipts, interest/debt reconciliation, and enforced on-chain collateral risk gates.
3. **Perpetuals:** require independently verified M5/M7/M12/M15 contracts, fresh authorized oracle, margin and insurance, canonical solvency/liquidation, independent security review, and distinct wallet-signed LONG and SHORT receipts. No simulated or external orderbook activity counts as Hoxo trading.
4. **Launch:** block financial beta and mainnet until all relevant acceptance evidence and independent security review exist. Never count self-trades or synthetic/wash volume.

All operations remain restricted to disposable, valueless Stellar Testnet assets. No private keys, signing or transaction submission in CI. This repository's source is licensed under the root MIT `LICENSE` with copyright Mushee 2026.
