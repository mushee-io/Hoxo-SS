# M23 — Public Stellar Testnet beta foundation (NOT OPEN)

**Status: code foundation built; public financial beta blocked.** Hoxo SS can expose a *read-only development preview* and network information, but cannot claim verified on-chain Hoxo trading, lending, custody, volume, PnL, liquidity or a live, externally audited beta.

## What M23 builds

- A stand-alone beta readiness page at `/beta/` with explicit disabled-trading messaging, no wallet signing or financial calls.
- A **fail-closed release gate** in `beta/readiness.mjs`. It derives current blockers from the strict Stellar Testnet registry, M21 transaction evidence and M22 audit readiness. A forged `auditApproved:true` JSON property cannot open trading.
- A **deterministic deployment inventory** for six compiled Soroban package artifacts. The SHA-256 hashes are computed from actual local WASM bytes; non-WASM, linked and missing artifacts are rejected or reported. It records precise evidence requirements but **never calls** `stellar contract deploy`, stores private keys, claims a C-address or changes the registry. The M5 oracle adapter remains a separate missing audited dependency.
- A **single-request operator-only Testnet faucet** using official `https://friendbot.stellar.org/?addr=<PUBLIC_G_ADDRESS>`. It validates the destination address, demands explicit operator acknowledgement, probes both canonical Horizon and RPC against Testnet, and only then makes one HTTPS request. Even on HTTP 200 it reports **independent Horizon balance verification pending**, never invented XLM ownership. No public funding API and no unattended repeating loop.
- One-shot **read-only infrastructure telemetry** that checks official Horizon/RPC health and ledger consistency with existing M4 code. It never claims this proves any Hoxo contract or financial operation. Trading-volume, TVL and PnL fields remain null.
- Reproducible tests for all gating, faucet, artifact and status logic; CI must pass and prove public-beta release remains denied.

## Operator commands

Default readiness, no network calls:

    npm run m23:readiness

Optional one-off live read-only Stellar Testnet RPC+Horizon inspection (network health only):

    npm run m23:readiness -- --live

Explicit release-denial regression (must exit non-zero):

    npm run m23:readiness -- --require-open

Review actual compiled WASM checksums without submitting transactions (the path must be an existing directory containing each `hoxo_*.wasm`):

    HOXO_SOURCE_COMMIT=<FULL_64_HEX_COMMIT> npm run m23:plan -- ./target/wasm32v1-none/release

If any WASM is absent or canonical oracle adapter remains missing, the operator CLI deliberately exits nonzero. A fully populated inventory is STILL NOT deployment, external audit, or public beta permission.

Preview a proposed G-address with **no request**:

    npm run m23:faucet -- <STELLAR_TESTNET_G_ADDRESS>

For an independently owned **public, non-mainnet** G-address and operator-confirmed request:

    HOXO_M23_FAUCET_ACK=REQUEST_VALUELESS_STELLAR_TESTNET_XLM npm run m23:faucet -- <STELLAR_TESTNET_G_ADDRESS> --request-testnet-funding

Never give the CLI an `S...` seed, mnemonic, credential, wallet recovery phrase or a mainnet/futurenet address. Stellar G-addresses are network-agnostic; the CLI validates the Testnet **endpoints**, not a purported account's intended network. A caller must verify the wallet is genuinely a Testnet-only key before making a request. Friendbot may decline repeated funding; review the independent Horizon account balance afterwards.

**Official reference:** <https://github.com/stellar/friendbot> and <https://developers.stellar.org/docs/tools/cli/cookbook/upload-deploy>.

## Deployment acceptance plan

1. Review the pinned SDK and CLI, Rust toolchain, source revision, `Cargo.lock` state, Testnet protocol upgrade and build results. Confirm each compiled WASM SHA-256 from actual bytes.
2. Complete and externally audit canonical M5 oracle and M7 on-chain risk authorization. Confirm correct asset token source/issuer/7-decimal balance rules. No real mainnet assets.
3. Resolve actual M15 adapter integration with M6/M9/M11/M12; **current product escrows are separate** and cannot be represented as a unified spendable margin balance.
4. Deploy via an independently controlled secure **Stellar Testnet** operator identity only after external deployment/security review; collect actual uploaded code hash, contract address, constructor calls, admin role, deployment hash, ledger proof and storage TTL evidence. Do not use a key stored in CI or chat.
5. Verify candidate entries in `registry/testnet.json` and independently compare installed on-chain code/contract fields. Neither candidate metadata nor CI build artefacts imply deployment/verification.
6. Run M21 signed multi-wallet real transactions, exact contract state and asset deltas, funding/interest/insurance, insolvency and replay checks. Document transaction hashes, wallets (public only), before/after states and independent proof.
7. Commission independent M22 security/economic audit, resolve all critical/high findings, rehearse on-chain pause, TTL archiving, RPC forks and recovery; sign off approved operators and monitoring.
8. Only then review formal public beta access, a **valueless supply-capped token faucet**, abuse controls, account risk disclosures, capacity limits, telemetry retention, responsible disclosure response and rollback. M24 mainnet launch is separately prohibited by default.

## Operational acceptance matrix

| Capability | Current source status | Public financial beta gate |
| --- | --- | --- |
| Read-only terminal, beta readiness page | Built | May be publicly viewed as an experimental preview; not a traded exchange |
| Live Testnet RPC/Horizon network check | Existing + M23 one-shot monitor | Can report network endpoint health, never active protocol liquidity |
| Stellar Testnet Friendbot operator request | Explicit one-shot CLI, gated by health/ack | Optional gas for separately controlled Testnet wallets only, never a public unattended faucet |
| Compiled WASM artifact SHA-256 inventory | Built, manual filesystem inputs | Not a deployment, on-chain code-hash check or audit |
| Verified Hoxo canonical contracts | Not yet | Require verified deployed IDs and code/permission checks |
| Testnet deposit/spot/lending/perp/repay/withdraw | Not verified | Blocked by M21 lifecycle and actual on-chain integrated state |
| Independent protocol audit and real chaos drills | Not yet | Blocked by M22 review/remediation |
| Financial trading, public beta, TVL, volume or mainnet | **Disabled** | Separate signed operational release required; code cannot grant itself |

## Responsible disclosure and incident response

See [SECURITY.md](../SECURITY.md). Privately alert maintainers via GitHub's private vulnerability reporting feature if enabled. Do not publish exploitation details against real deployments. Preserve Testnet receipts and immutable artifacts, halt affected services, pause any verified on-chain contracts under reviewed guardian roles, investigate source/ledger drift and fund losses, and require independent review before re-opening. The present M20 process-local pause is not a deployed contract guardian.

**M23 does not open public beta.** Passing this milestone's software tests is not evidence of audited trading or live blockchain transactions.


### M5 candidate oracle in source

`contracts/oracle-adapter` now implements a single-market two-publisher Testnet price candidate with 120s freshness and fail-closed pause; it is neither deployed nor independently audited. The M23 WASM inventory now expects seven packages including `hoxo_oracle_adapter.wasm`. See [the operator handoff](testnet-execution-handoff.md).
