# M30 — Soroban integer boundary checks for debt waterfall

The M29 read-only debt waterfall now rejects all monetary inputs outside the non-negative signed Soroban `i128` domain (`0..2^127-1`) before calculating allocations. This avoids JavaScript `BigInt` previews accepting inputs that a future Soroban contract could not represent. It is a defensive input-domain check, **not** an executable liquidation or cross-product repayment implementation.

The deterministic tests exercise every input at `2^127`, and a boundary scenario at `2^127-1`. The reference implementation still returns `executable:false` and `riskApproved:false`. It uses exact integer units of one token, not cross-asset exchange rates or unrealised profits.

**Outstanding:** authenticated M11 current accrued debt, M12 realised proceeds and insurance accounting, M15 custody transfers, per-market and per-user authorisation, atomic Soroban settlement and rollback tests, live Testnet operator-signed deployment and bilateral trading receipts, and independent security/economic review. No public financial beta or mainnet activation is authorised.
