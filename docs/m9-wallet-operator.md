# M9 — Two-wallet Stellar Testnet settlement operator

**M9 has already been merged into main.** This follow-up adds a guarded actual-wallet transaction path. It does not assert that the M9 contract has been deployed.

## New implementation

- matching/m9-wallet-settlement.mjs validates the exact 13 Soroban MatchTerms fields and integer minimal-unit amounts.
- Verified Testnet RPC preflight checks passphrase, ledger, deployment candidate, on-chain contract method interface, pause status, match replay, approved token addresses, seven-decimal compatibility and payer balances.
- The official Stellar SDK simulates a single settlement operation. The maker signs the envelope and the taker signs the distinct non-invoker Soroban authorisation entry.
- No private keys are needed for default simulation. Broadcast requires an explicit acknowledgement and two independently controlled funded Testnet wallets.
- Final success requires a confirmed network transaction AND an on-chain receipt matching the exact match ID, both order IDs, participants, assets and token quantities.
- Tests use mocked SDK/RPC and must never be described as evidence of an actual Testnet swap.

## Operator steps

1. Build and deploy the reviewed M9 WASM to Stellar Testnet, record genuine contract ID, transaction hash and ledger. Independently query its contract instance. Update the spot-settlement entry in registry/testnet.json to candidate only after verifying deployment.
2. Approve two genuine seven-decimal Stellar Testnet token contracts, fund two independent wallet accounts with valueless tokens, and unpause the deployed settlement contract.
3. Prepare the exact 13-field MatchTerms JSON OUTSIDE the repository. Three IDs (match_id, maker_order_id, taker_order_id) are 32-byte hex. The other fields are maker and taker G addresses, base_token and quote_token C addresses, base_amount, quote_amount, maker_limit_e7, taker_limit_e7 integer strings, maker_side (0 sell / 1 buy), and expires_at_ledger (within 100 current ledgers). Both parties must explicitly consent to these exact terms.
4. Install dependencies using npm install. Set HOXO_M9_CONTRACT_ID to the genuine Testnet contract ID and HOXO_M9_TERMS_FILE to the private terms file; run npm run m9:preflight. Simulation mode never sends a transaction.
5. For a reviewed valueless bilateral test ONLY, inject HOXO_M9_MAKER_SECRET and HOXO_M9_TAKER_SECRET using secure local process environment. Do not paste seeds into chat, write them in shell history or commit them. Then set HOXO_M9_SEND=I_ACCEPT_STELLAR_TESTNET_SETTLEMENT and run npm run m9:preflight. The SDK handles network-specific Soroban signatures.
6. Independently inspect the returned hash on Stellar Testnet RPC and verify on-chain receipt, both wallet balances and replay rejection.

## What is not finished

No Hoxo M9 contract is registered as deployed, no approved Testnet token pair is recorded and no live wallet-signed settlement has been verified. The script is an operator-only path, not an unattended trading agent or a public UI route. M8 signed matching intents DO NOT grant spending authority, and the CLI does not establish M8 fill provenance, canonical vault margin, perp position or lending debt. M6/M7 risk integration and security review remain open.

**Never enable public trading simply because a script or native test passes.**
