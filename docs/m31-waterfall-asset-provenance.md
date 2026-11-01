# M31 — Asset-bound debt waterfall preflight

The M29 debt-loss waterfall assumes that accrued M11 debt, realised M12 liquidation proceeds, M12 insurance and liquidation costs are all denominated in the **same canonical Soroban token**. M31 adds a fail-closed, read-only wrapper that requires explicit matching Stellar contract identifiers for all four amounts. It rejects missing identifiers and cross-token substitutions instead of silently treating amounts from different assets as fungible.

This wrapper **does not authenticate** its caller-supplied identifiers or amounts. The returned `provenanceVerified:false`, `executable:false` and `riskApproved:false` flags are intentional. Actual M11/M12/M15 integration must independently read authenticated on-chain debt, realised token movements, reserves, contract addresses and operator permissions. It must also enforce atomic settlement and rollback on Soroban. This preview must never be used as an authorisation to borrow, liquidate, trade or transfer tokens.

No Testnet contract deployment, signed trade or independent audit is established by this change. Public financial Testnet beta stays closed; mainnet remains out of scope.
