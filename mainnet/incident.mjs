/**
 * M24 tabletop-only incident decision support — no real remote controls.
 * Contract guardians must be separately audited and exercised on-chain.
 */
export const M24_INCIDENTS=Object.freeze({
  oracle_stale:Object.freeze({
    severity:"CRITICAL",commander:"risk incident commander",
    trigger:"Authenticated oracle source stale/divergent or market mark/index mismatch",
    steps:[
      "Declare incident, record UTC timestamp and last independently verified on-chain price/ledger.",
      "Request authorised on-chain halt of new leverage, borrowing and unsafe liquidation; never imply M20 process-local pause is sufficient.",
      "Preserve wallet-controlled safe unwind and withdrawals only if independent on-chain risk assessment confirms solvency.",
      "Verify independent oracle source freshness and smart-contract risk guards before requesting restricted restart."
    ],
    proof:[
      "Independent oracle feed provenance and latest ledger",
      "Actual guardian role and paused contract transaction hashes",
      "Before/after collateral solvency and affected order cancellations",
      "Risk committee plus independent security approval before any restart"
    ]
  }),
  rpc_fork:Object.freeze({
    severity:"HIGH",commander:"SRE incident commander",
    trigger:"Horizon/RPC ledger hash or height diverges, retention reset or replay detected",
    steps:[
      "Disable all unverified indexer-derived financial credits or settlement decisions.",
      "Freeze new user-facing financial action routing until independent nodes reconcile canonical state.",
      "Preserve signed journal, provider responses and immutable ledger anchors.",
      "Rebuild observations from verified history without re-broadcasting prior user transactions."
    ],
    proof:[
      "Independent network ledger hash agreement",
      "Gap-free checkpoint and transaction replay evidence",
      "Indexer backfill and reconciliation sign-off"
    ]
  }),
  custody_deficit:Object.freeze({
    severity:"CRITICAL",commander:"treasury and security guardian",
    trigger:"Verifiable contract token holdings fall below user claims/reserved obligations",
    steps:[
      "Declare solvency incident, alert authorised guardians and pause new liabilities on-chain.",
      "Preserve claims, user exits and legally required notifications; do not fabricate compensating liquidity.",
      "Reconcile all token/issuer balances, custody contracts, debt interest, insurance and outstanding perp exposures.",
      "Escalate to independent auditors, legal/compliance and governance before any capital action."
    ],
    proof:[
      "Actual pre/post on-chain token balances and liability snapshots",
      "Independent incident ledger and loss allocation",
      "Documented reserve capital source and incident authorisation"
    ]
  }),
  signer_compromise:Object.freeze({
    severity:"CRITICAL",commander:"key security incident commander",
    trigger:"Potential operator, oracle, guardian or governance signer compromise",
    steps:[
      "Stop use of compromised identities and escalate to out-of-band authorised multisig guardians.",
      "Revoke or rotate on-chain roles only through reviewed, pre-authorised contract access control.",
      "Freeze upgrade permissions and key-bearing deployments; preserve approved recovery channels.",
      "Require independent proof of role/threshold changes before restart."
    ],
    proof:[
      "Old/new signer public IDs and on-chain access-control history",
      "Sealed incident root-cause review with no private keys in logs",
      "Independent quorum and recovery authorisation"
    ]
  }),
  liquidation_failure:Object.freeze({
    severity:"CRITICAL",commander:"risk and market operations",
    trigger:"Liquidation keeper liveness, bad debt, funding or insurance accounting failure",
    steps:[
      "Halt new risk exposure through audited contract-level controllers.",
      "Compute verified actual debt, insurance shortfall, collateral settlement and keeper queue state.",
      "Exercise staged repay/unwind using bounded authorised operators, with receipt and solvency checks.",
      "Require risk, security and external auditor review before restoring liquidations."
    ],
    proof:[
      "Independent position, debt and insurance snapshots",
      "Liquidation receipts and proof of full/partial atomic state deltas",
      "Documented stress and secondary keeper failover results"
    ]
  }),
  upgrade_mismatch:Object.freeze({
    severity:"CRITICAL",commander:"release manager and multisig governance",
    trigger:"Installed contract code hash, owner, upgrade authority or runtime does not match approved launch manifest",
    steps:[
      "Stop rollout and pause further privileged upgrades via reviewed governance.",
      "Independently compare deployed WASM and installed bytecode against audited source-revision hashes.",
      "Revoke unapproved operator privileges and quarantine affected market access.",
      "Consider reversible interface rollback only; smart-contract transactions cannot be assumed reversible."
    ],
    proof:[
      "External read of deployed WASM hashes and contract addresses",
      "Signed governance authorisation and affected upgrade receipts",
      "Independent post-recovery deployment and account-state attestation"
    ]
  })
});
export const M24_INCIDENT_TYPES=Object.freeze(Object.keys(M24_INCIDENTS));
export function simulateM24Incident(type,{operatorRole="tabletop-operator"}={}){
  if(typeof type!=="string"||!Object.hasOwn(M24_INCIDENTS,type))
    throw Error("M24 unknown incident type");
  if(typeof operatorRole!=="string"||operatorRole.length<3||
     operatorRole.length>100||/[\r\n]/.test(operatorRole))
    throw Error("M24 invalid tabletop operator role");
  const d=M24_INCIDENTS[type];
  return Object.freeze({
    milestone:"M24",scenario:type,severity:d.severity,
    mode:"OFFLINE_TABLETOP_SIMULATION_ONLY",
    trigger:d.trigger,decisionOwner:d.commander,
    exerciseOperatorRole:operatorRole,
    actionPlan:d.steps.map((step,i)=>({sequence:i+1,step,executed:false})),
    requiredEvidence:d.proof.map(item=>({item,verified:false})),
    remoteControlInvoked:false,
    onchainPauseExecuted:false,
    walletsSigned:false,
    fundsMoved:false,
    liveIncidentResolved:false,
    launchPermitted:false,
    note:"This is a planning rehearsal. M20 pause gates are local services, not audited on-chain guardian permissions."
  });
}
