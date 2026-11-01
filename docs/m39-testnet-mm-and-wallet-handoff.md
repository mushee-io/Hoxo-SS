# M39 — Stellar Testnet market-maker quote safeguards and operator handoff

**Status: offline quote planning only. All seven Hoxo canonical Testnet contracts are still UNDEPLOYED. There are NO real Hoxo fills, live Testnet market maker or public financial beta.**

## Purpose

A market maker provides passive buy and sell liquidity around an independent real reference price. Genuine maker/taker transactions can help test a Testnet trading system, including limits, collateral movement, fees, risk and indexer integrity. **Unsigned order intents, simulated fills, self trades, reciprocal wash trading or merely generating quotes are not volume.** Never misrepresent them as real on-chain trades, commercial usage or traction.

The new `mm/quote-plan.mjs` exposes `prepareTestnetMakerQuotePlan`. It produces a **non-executable** two-sided plan for the existing reference spot and perp markets.

The planner enforces:

- Exact Stellar Testnet passphrase and a checksum-valid public maker G-account; never accepts signing keys or arbitrary markets.
- Fresh reference observations not older than 30 seconds and not from the future, while clearly declaring the price caller-supplied and **not authenticated** by any verified on-chain oracle.
- Decimal fixed-point seven-place quotes, a deterministic two-sided spread, positive bounded size, price, and spread; bid cannot cross ask. Very small unrepresentable tick/spread combinations fail closed.
- Independent base/quote inventory tests with explicit idle-reserve buffers: bids reserve quote tokens, asks reserve base tokens. **No netting opposing orders**, no unbacked leverage, no spending against another person's collateral, no implied available liquidity.
- A per-order maximum quote notional and exact BigInt rounding of token debits.
- Immutable quote-plan output, with signed/submitted/executable flags always **false**, and confirmed trade count and volume **zero**.
- Rejects extra/missing properties, accessor-backed fields and malformed quantities.

`npm run test:mm` runs adversarial tests. `npm test` includes them in the full suite.

## Planned integration after actual contracts exist

The honest implementation order is:

1. **Testnet XLM only:** user verifies the wallet is actually funded on network `Test SDF Network ; September 2015`. Mainnet XLM balances do not fund Testnet, even when the public G-address is the same. Operator also needs a locally secured CLI signing identity; **never send its seed or secret key in chat**.
2. **Public token discovery:** review actual valueless Testnet 7-decimal token contract(s), signer/issuer, faucet and holders. The reference `xlm-usdc-spot` symbol in the sandbox is not a real deployed or price-confirmed token market.
3. **Operator deployment:** build and independently check the exact audited/reviewed WASM files, then run the existing `npm run testnet:deploy -- <role> /local/public-config.json` dry runs. Execute contract deployment interactively and manually with the secure local signer only after reviewing exact contract constructors, chain ID, source/WASM hashes and risk controls. See [M25](m25-testnet-operator-activation.md). Never unpause credit/leverage as a shortcut.
4. **Spot two-wallet test:** prove real valueless Testnet tokens, matching contract IDs and token balances, independently authorize maker and taker wallets, settle genuine M9 bilateral DvP and verify the actual transaction status and XDR token deltas. Only then may those actual events be reported as **verified Testnet volume**, with a distinct `testnet` label.
5. **Perp separately:** implement and review a real canonical `approve_open` risk gate, independent recent dual-publisher oracle, funded isolated collateral, margin, position PnL/funding and full atomic liquidations. Current canonical risk `approve_open` deliberately refuses; a mock permissive contract is never a production replacement. **Do not enable leveraged perps yet.**
6. **Maker safely:** connect quote suggestions to independent signed order intents and verified on-chain settlement, with separate maker/taker ownership, no self-matches, quote expiry, inventory reconciliation, per-market price checks, limits, rate caps, pause and circuit-breakers. Monitor genuine filled volumes from independent settled receipts, not matched sandbox events.

## When the user needs to step in

**The next real-world step requires the authorised wallet owner/operator**, after the independent code, token and deployment review. The operator should confirm the available G-addresses are actually funded with Testnet XLM, decide which are operator/maker/taker and separately controlled oracle publishers, and locally authorize deployment and two-wallet Testnet transfers. Public G-addresses and transaction hashes may be shared for read-only verification. Never share an S-address, recovery phrase, private key, wallet login, API token, or CLI seed.

A publicly verified Hoxo deployment, valid M9 spot settlement and fully risk-checked perpetual positions must be demonstrated before these are described as live.
