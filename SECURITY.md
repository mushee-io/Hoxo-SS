# Security policy

Hoxo-SS is experimental. Do not deposit mainnet assets or rely on its JavaScript reference model for enforcement.

Report vulnerabilities **privately** via GitHub's repository Security > Report a vulnerability feature when available, or an established private channel with repository maintainers. Do not include exploits or secrets in public issues, PRs or community chats. Submit a concise impact summary, affected commit/contract version, reproducible steps on an isolated environment, severity and suggested mitigation; NEVER submit any live private keys, mnemonic phrases or regulated customer data. Maintainers should acknowledge privately, assign ownership, halt affected development services, preserve evidence, investigate and review remediation before coordinated disclosure. Do not publish exploits against live deployments. No production contract IDs, approved deployment, audit or bug bounty are advertised.

Baseline safeguards before any public beta: formal threat model; audited custody contracts; wallet authorization; oracle and stale-price defenses; no double-count collateral; invariant and adversarial tests; strict slippage bounds; event indexing reconciliation; permissions/upgrade review; liquidation and bad-debt protection; independent external audit.


## M23 beta release and Testnet disclosure

The proposed public beta remains **closed**. There are no independently verified Hoxo exchange contract deployments, audited oracle/risk authority, or completed M21 economic transaction proofs. Responsible testers may use only their own valueless Stellar Testnet assets for independently approved tests. Operators must not request testers transfer customer funds to purported Hoxo addresses. No bug bounty, compensation, custody service or guaranteed response time is offered. M20 process-local pauses do **not** constitute on-chain guardian authority. See [M23 readiness](docs/m23-beta-readiness.md) and [M22 audit blockers](docs/m22-audit-chaos.md).
