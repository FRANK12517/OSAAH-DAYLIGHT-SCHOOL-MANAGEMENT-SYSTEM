# TiDB schema recovery blockers

Phase 2C source review completed against baseline `c89975d1306d7686adec12c3bbe20e177927570f`. Production DDL recovery remains blocked.

1. **Authoritative source:** no complete active TiDB DDL was found for any of 66 active application tables; PostgreSQL and historical mixed-dialect migrations are not substitutes. **Next:** repository/database owner supplies the approved schema release artifact, migration history, or a secure catalog export with provenance.
2. **Production target identity:** actual TiDB version, SQL mode, session time zone, charset/collation, and FK enforcement settings are unknown. **Next:** environment owner supplies verified target metadata and a read-only connection path.
3. **Credential/config selection:** adapter rejects invalid/non-MySQL URL schemes as `DATABASE_URL_INVALID` before pool creation. Vercel environment listing was blocked by CLI update-metadata fetch failure. **Next:** owner confirms correct Vercel environment variable names/scope and configures TiDB credentials securely; do not send secrets in chat or commit them.
4. **Current state and migrations:** no applied-migration evidence or live catalog could be inspected. **Next:** perform read-only catalog and migration-state inspection only after connection is verified; do not mutate production.
5. **Per-entity contracts:** active query expectations coexist with historical type/key conflicts, and 92 tables plus 3 views remain unresolved. **Next:** domain owners resolve object lifecycle and field-level contract gaps with linked evidence; preserve classifications until supported.
6. **Relationships and transactions:** joins are query evidence, 400 FK entries are historical candidates, and exact join predicates/transaction retry/idempotency lifecycle are not approved as constraints. **Next:** inspect full source queries and workflow boundaries; validate candidate indexes/constraints against data and TiDB version.
7. **Compatibility:** AUTO_INCREMENT, generated columns, JSON, timestamp, collation, index limits, and transaction semantics are version/session-sensitive. **Next:** validate candidate DDL and behavior against an isolated instance matching the verified production TiDB version.

Do not publish application DDL, initialize, integrate auth against an assumed schema, change production data, merge, or deploy until blockers are resolved and the canonical contract passes independent review.
