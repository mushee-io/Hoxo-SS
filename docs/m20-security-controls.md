# M20 — Security and operator controls (foundation)

**Status: implemented in code; independent operational approval not granted.** These controls protect the **non-executable Stellar Testnet sandbox** and **read-only candidate indexer**. They do not authorize wallet spending, actual settlement, mainnet trades or a deployed Hoxo oracle.

## Threat model and trust boundaries

| Threat | Mitigation | Remaining risk |
| --- | --- | --- |
| HTTP floods, spoofed client addresses | Per-socket and global request budgets, bounded client-key map, 429 with Retry-After; ignore X-Forwarded-For; loopback bind | In-process counters cannot stop distributed abuse or coordinate across replicas |
| Cross-site write and unauthorised signing | Browser Origin/fetch-site checks, explicit UNSETTLED acknowledgement, existing exact-payload Stellar Ed25519 verification | Malicious local software or stolen wallet key remains a risk |
| Nonces, replays, forged order identities | Existing domain-separated M8/M17 intent signatures, durable hash-chain and replay checks | Only off-chain sandbox actions are authenticated; not on-chain authority |
| Stale/outage prices | Existing M5 candidate oracle kill switch and M17 signed-tick age/monotonicity; M20 default oracle pause blocks new price-dependent sandbox commands | No approved canonical smart-contract oracle, source quorum or live oracle failsafe yet |
| Unauthorized administrative changes | Pause/resume operator capability available only inside the process; **no HTTP operator or key-management endpoint** | Host/process access must be secured; memory-only pause decisions are not an audit-grade governance trail |
| RPC forks, resets and retention gaps | Existing M19 ledger hashes and HALT; separate M20 indexer pause | Provider RPC claims are not independently verified chain consensus |
| Journal rewriting | Existing M8/M19 fsynced hash-chained journals and restart checks | Keep trusted offline backups; hash chains cannot prevent full-history replacement |
| Unauthorized trading or custody | No transaction execute route; readiness remains disabled; status always executionPermitted=false | Smart contracts M6–M16 need separate audits and real ledger verification |

## Roles and minimisation

- **Viewer:** reads public Testnet and local read-only telemetry only.
- **Sandbox signer:** signs exact Stellar Testnet-domain off-chain order commands; cannot transfer funds.
- **Sandbox tick signer:** an explicitly configured public G-address signs M17 local simulation ticks; this is **not** an authorised oracle.
- **Process operator:** sole local capability holder for sandbox, oracle and indexer pause toggles. No HTTP admin endpoint or embedded private keys.
- **On-chain contract owner/guardian/keeper:** none provisioned or authorised by M20.

## Operator flags

All CLI M20 gates start **paused**. To explicitly allow **off-chain only** signed sandbox order inputs, launch:

    HOXO_M20_SANDBOX_PAUSED=NO HOXO_M20_ORACLE_PAUSED=NO npm run dev:matching

The two flags are separate so that a suspect price source can halt new price-dependent commands. Authenticated cancellations remain possible while paused, but they are **sandbox** cancellations only.

For read-only candidate observation, first verify the registry's candidate entries and use:

    HOXO_M19_OBSERVE_CANDIDATES=YES HOXO_M20_INDEXER_PAUSED=NO npm run dev:indexer

Indexer observation continues to require the existing M19 opt-in, candidate contract IDs and ledger-fingerprint/retention validation. An M19 HALT cannot be overridden by clearing M20's pause.

Only uppercase literal NO unpauses a gate at startup; any other value keeps it paused. **No live pause/resume network API exists.** To change CLI gates, restart the service and preserve its journals. Neither the operator capability nor these flags can grant on-chain spending authority.

## Incident and recovery

1. Restart the affected service without the NO unpause flag. Leave oracle paused for any suspected stale or anomalous price.
2. Preserve journal files, hash checkpoints, error logs, registry and passphrase evidence. Do not erase suspicious ledger rows or manually clear a HALT.
3. Investigate key compromise, replay, RPC head hash differences, time skew and untrusted price inputs. Keep sensitive secrets out of reports.
4. Obtain independent review before unpausing. Re-run local CI checks and wallet-specific Testnet fault drills.
5. Treat M21 (real wallet test flows), M22 (fuzz/audit/chaos), M23 (beta) and M24 (mainnet approval) as **separate blocked gates**.

## Validation

    npm run test:security
    npm test
    npm run check:readiness

The security suite covers default-deny, scope separation, cancellation during emergencies, oracle outage, bounded rate abuse, forwarded-header spoofing, HTTP pause-route denial and API status honesty.

**Not completed:** production cross-instance rate limiting, a security incident service, independent audit, contract-admin minimisation and upgrades, on-chain guardian pause wiring, real oracle failover, fuzzing and real transaction fault injection. The exchange remains undeployed and non-executable.
