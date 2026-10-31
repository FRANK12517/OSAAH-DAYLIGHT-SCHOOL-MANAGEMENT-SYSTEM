# TiDB schema source recovery

**Status: complete local source review; canonical application schema remains blocked.**

- Repository: `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`
- Verified branch and baseline: `codex/tidb-only-runtime` at `c89975d1306d7686adec12c3bbe20e177927570f`.
- Target: TiDB database `osaahdaylightschool`, single school `sch_default_01`. Production TiDB version and catalog remain unknown.
- Original application tables assessed: 159; active runtime tables: 66; fully authoritative active TiDB definitions: 0; partially recovered: 66; unresolved table dispositions: 92; compatibility alternatives: 1.
- Historical views: 5 supported-workflow candidates and 3 unresolved; canonical view definitions recovered: 0.
- Runtime write-column expectations: 129; confirmed physical columns: 0. Confirmed primary keys, unique constraints, indexes, and foreign keys: 0 each. Runtime modules mapped: 115; complete contracts: 0.

## Sources examined

The Phase 2B per-entity manifest and reconciliation ledger were reviewed alongside repository Git history, numbered schema files, PostgreSQL snapshots, runtime SQL observations, adapter configuration, and available deployment metadata. The current schema folder has 82 numbered SQL migration files. Local Git-history review found no deleted or renamed schema SQL files; no Drizzle/ORM schema definitions or local database dump/backup were found.

| Source | Provenance | Finding |
|---|---|---|
| `schema/001_foundation.sql` | `7a26fd67a9d9e3150bf5252b5ede35fb14461d21` | SQLite-oriented foundation (PRAGMA, TEXT/INTEGER), not TiDB authority. |
| `schema/068_academic_score_records_foundation.sql` | `55d3f3a74d842e508b956e44edcd49454d121968` | MySQL-like historical DDL; version/session behavior and active catalog not established. |
| `schema/082_parent_sms_auth.sql` | `fafe61b217f7d0f344d107cd2743216e0a05e178` | Pre-existing untracked checkout artifact; cannot establish complete live schema. |
| `schema/083_result_blocking_tidb_scope.sql` | `e142db137ac3cfd1a60c6981774763df59612333` | TiDB-oriented migration candidate; target version and applied state not verified. |
| `supabase/migrations/202610150001_osaah_daylight_schema.sql` | `800f0191785c853fe7099008073d231c742728e3` | PostgreSQL baseline derived from repository migration/runtime evidence; not independent TiDB authority. |
| `supabase/reconciliation/202610180001_captured_12_table_structural_stage.sql` | PostgreSQL catalog capture | Limited to a captured 12-table PostgreSQL schema, not target TiDB. |

## Property confidence

- **AUTHORITATIVE:** object identity and runtime dependency only, as application-scope facts; no physical application DDL property qualifies.
- **CORROBORATED:** none promoted. The PostgreSQL baseline is derived from repository sources and is not an independent TiDB source.
- **INFERRED:** runtime read/write expectations and historical column/key/index/foreign-key candidates. These are not executable definitions.
- **UNKNOWN:** complete current types, nullability, defaults, generated/auto-increment behavior, enforced constraints, referential actions, charset/collation, timestamp semantics, target TiDB version, transaction/locking behavior, and live physical state.

The full per-table evidence, paths, lines, candidates, and confidence grades are in [machine-readable source evidence](tidb-schema-source-evidence.json). The proposed canonical contract is intentionally empty and non-executable in [authoritative schema JSON](tidb-authoritative-schema.json).

## TiDB compatibility findings

MySQL protocol compatibility does not establish version-specific equivalence. TiDB documents unsupported MySQL features and differences in defaults and behavior ([MySQL compatibility](https://docs.pingcap.com/tidb/stable/mysql-compatibility/)). TiDB foreign keys require appropriate indexed columns and matching definitions; inline `REFERENCES` clauses are parsed but ignored, so only supported table-level constraints establish enforcement ([foreign keys](https://docs.pingcap.com/tidb/stable/foreign-key/)). Session time zone affects `TIMESTAMP` behavior ([time zone configuration](https://docs.pingcap.com/tidb/stable/configure-time-zone/)); auto-increment and generated-column behavior also need target-version validation ([AUTO_INCREMENT](https://docs.pingcap.com/tidb/dev/auto-increment/), [generated columns](https://docs.pingcap.com/tidb/v7.1/generated-columns/)). No production compatibility claim is made because no live target connection or version check occurred.

## Connection investigation

The TiDB adapter requires explicit `OSAAH_DATABASE_ADAPTER=tidb` and accepts a MySQL-family `DATABASE_URL` or component configuration; malformed or non-MySQL schemes fail with `DATABASE_URL_INVALID` before pool creation. The previously inspected local environment was not a trustworthy production source. Vercel environment listing could not complete because the CLI failed while fetching its npm update metadata; no credential values were displayed. No live connection was made. The environment owner must supply the correct Vercel-scoped TiDB configuration securely, then authorize a read-only version and catalog inspection.
