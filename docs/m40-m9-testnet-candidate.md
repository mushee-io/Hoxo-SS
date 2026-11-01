# M40 — M9 Stellar Testnet deployment candidate (not trading activation)

On 2026-11-01 an operator supplied the following **public Testnet-only evidence**. These are reported observations, not independently reverified by this PR:

- WASM upload transaction: `2ba5e907a26265f8f818de342367b266a07d7082ea90b4815112fc5d715758bd`, ledger 5506305.
- Reported uploaded WASM file SHA-256: `916917c61fc36a55929201027a98625097f6e8ee74f26de255728f451de4fcc3`.
- CreateContractV2 transaction: `91280d18358b642ae31668ed114b879a52e175c842ee869f23d28666558e640a`, ledger 5506371, 2026-11-01T17:51:35Z.
- Operator/source/claimed constructor owner: `GCT7YPNK7JAC2FREF5WLROOWQAWRQQV7US2ZB5YK355QV37SAWNERHDB`.
- Reported contract ID: `CCPT6NJCGNHFTTV54IHGSNKTKD74HFCTDKWA3XIP466YT7JHUILJZCYF`.

Links: [Testnet upload](https://stellar.expert/explorer/testnet/tx/2ba5e907a26265f8f818de342367b266a07d7082ea90b4815112fc5d715758bd) and [Testnet deployment](https://stellar.expert/explorer/testnet/tx/91280d18358b642ae31668ed114b879a52e175c842ee869f23d28666558e640a).

`verification/m9-candidate-evidence.mjs` validates public-only metadata but **cannot authenticate it**. Its result is permanently non-authorizing, including if the candidate's booleans are supplied as true. Do not infer a code hash from the uploaded file SHA-256: Stellar contract code hash, deployed WASM hash and file SHA-256 are distinct evidence checks.

## Independent verification required before registry update

1. Fetch upload and CreateContractV2 transaction XDR/metadata from Stellar Testnet RPC/Horizon; verify successful ledger inclusion and that CreateContractV2 created this exact C-address.
2. Independently rebuild/review the M9 WASM and compare actual deployed contract WASM bytes and code hash, not just the upload transaction.
3. Read the deployed contract owner/admin and paused state. Confirm expected owner and **paused=true**. Record exact RPC responses/ledger and reproducible commands in a reviewed evidence PR.
4. Only then promote `spot-settlement` in the deployment registry to an appropriately limited verified candidate state. Do not mark other eight roles deployed.
5. Separately test approved valueless token custody and signed settlement between **two genuinely independent** maker/taker parties; verify ledger receipts, balances and replay prevention. Never count self-trades or invented volume.
6. Keep lending, perps and public beta disabled until independent risk, oracle, liquidation and security gates are satisfied.

This PR does not request wallet secrets, change contract state, broadcast transactions or authorize public trading.
