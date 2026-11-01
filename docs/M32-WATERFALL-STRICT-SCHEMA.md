# M32 — Fail-closed debt-waterfall preview input schema

The read-only asset-bound M31 preview now rejects unexpected string or symbol keys, non-record input, missing required token identifiers and mandatory monetary inputs. This avoids silently discarding misspelled amounts, misleading risk flags or future fields that have not been reviewed. `liquidationCostE7` remains optional with a zero default for backwards compatibility. Inputs must be ordinary records with own properties; the wrapper does not accept class instances or inherited data.

`npm test` includes regression coverage for these cases and unchanged conservation/non-executable flags.

**Scope:** This is input validation for a read-only reference calculation, not an authenticated ledger read or executable settlement. Contract IDs remain shape-checked only and do not establish valid Stellar StrKey checksums, deployed code identity, token ownership or asset provenance. All input amounts remain caller-supplied. Do not use these previews to approve borrowing, liquidation or transfers.

**Next:** independently authenticate Soroban contract state and signed source receipts, implement atomic M11/M12/M15 debt settlement and rollback with valueless Testnet assets, verify contract deployments and actual signed trades, then complete security review. Public financial Testnet beta remains CLOSED; mainnet is out of scope.
