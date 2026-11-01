# M39 — nine-contract Testnet deployment coverage diagnostic

**Read-only, not a deployment, not trading authorization.**

The canonical `registry/testnet.json` currently tracks seven roles with null contract IDs. The intended nine-role execution inventory additionally requires `custody-router` (M38 owner repayment route) and `portfolio-accounting`. This milestone deliberately **does not** insert fictitious contract addresses, hashes or receipts or silently change the strict seven-role registry schema.

`deployment/nine-contract-coverage.mjs` validates the existing Testnet registry and reports missing roles, metadata candidates and independently verified status. It always returns `executionEnabled: false`: a registry entry alone cannot prove deployed code, correct constructors, binding, signer authority, storage TTL, real token custody or safe execution.

To progress: explicitly migrate the registry schema and all deployment/operator/CI consumers to nine roles; identify the audited canonical contract graph and resolve whether `canonical-risk` supersedes `risk-engine`; build and deploy only valueless Testnet contracts with external operator approval; verify transaction receipts, WASM hashes, constructors, binding, and actual on-chain state independently. No mainnet funds or credentials are needed for this diagnostic.

Run `node --test tests/nine-contract-coverage.test.mjs`. Existing risk gates, disabled trading controls and all previous milestones are unchanged.
