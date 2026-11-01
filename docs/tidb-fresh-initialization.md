# TiDB fresh initialization

## Status

The repository does not yet contain a complete, authoritative TiDB fresh-install schema plan. Do not run a fresh initialization against any database until that plan has been reviewed and checked in. In particular, `docs/database-schema-inventory.md` is a merged historical inventory: it retains superseded definitions and cannot safely be executed as current DDL. The PostgreSQL baseline under `supabase/migrations/` has different SQL, types, constraints, and runtime assumptions, so it is not an executable TiDB schema either.

Phase 2's generated [requirements matrix](tidb-canonical-schema-plan.md) and [machine-readable evidence manifest](tidb-schema-requirements-manifest.json) are source-scanning artifacts. They classify every historical table name, record extracted SQL table operations, compare parallel PostgreSQL schema evidence, and preserve unresolved conflicts. They are explicitly not a canonical DDL contract.

No fresh-install CLI command is published yet. This is intentional: an initializer without the full schema contract could create a partial database and report it as successful.

## Safety runner

`src/platform/tidb-fresh-initializer.js` provides the guarded execution and verification layer for a future checked-in plan. A plan must identify itself as `canonical-fresh-install`, target TiDB schema version 1, include non-empty DDL and metadata contracts, and carry a SHA-256 checksum over its DDL and contracts.

The runner:

1. Requires the TiDB adapter, verifies `VERSION()` identifies TiDB, and requires `DATABASE()` to be exactly `osaahdaylightschool`.
2. Performs a read-only object preflight before creating migration metadata. If application tables or views already exist without a fresh-install ledger, it refuses without adding metadata or executing schema DDL. For an empty database, it creates/uses the existing migration metadata and lock, then rechecks the database state under the lock.
3. Executes only the supplied canonical DDL statements; it does not discover or replay numbered historical migrations.
4. Independently checks the complete planned table set, column types and nullability, primary/unique/secondary indexes, and declared foreign keys using `information_schema`.
5. Records the fresh-install ledger only after all checks pass.
6. On a repeat run, verifies the matching checksum and all schema postconditions without replaying DDL. If an install ledger exists without a completion record, it stops with `FRESH_SCHEMA_RECOVERY_REQUIRED` and requires a separately reviewed recovery procedure; TiDB DDL is not treated as transactionally rolled back.

The application school remains `sch_default_01`; the initializer does not insert school or operational records. The existing fail-fast migration verifier requirement remains in force for historical upgrade paths.

## Configuration contract

The TiDB adapter uses verified TLS (`rejectUnauthorized: true`, TLS 1.2 minimum). When `DATABASE_URL` is configured, its host, port, database, username, and password are authoritative. Any supplied component variable must agree; mismatches fail with a sanitized `DATABASE_CONFIGURATION_CONFLICT`. Without a URL, explicit `TIDB_*` variables take precedence over generic `HOST`, `PORT`, and `DATABASE`; conflicting values fail. The canonical database name is enforced by the adapter.

The adapter accepts either:

- `DATABASE_URL=mysql://<user>:<password>@<host>:<port>/osaahdaylightschool` (with percent-encoded URL credentials where needed), or
- `TIDB_HOST`, `TIDB_PORT` (optional, defaults to 3306), `TIDB_DATABASE=osaahdaylightschool`, `TIDB_USER`, and `TIDB_PASSWORD`.

`TIDB_CA_CERT` is optional and supplies a trusted CA certificate; it does not disable certificate verification. Never log the URL or credential variables.

## Work needed before publishing a command

The canonical plan must be reconciled against current runtime repository SQL and the latest standardized application schema. The 157-table historical inventory is a discovery aid, not proof that all 157 tables are current or that their merged definitions are correct. Review must determine each current table, column, type, nullability, default, primary/unique key, index, and required relationship, including TiDB-compatible translations and single-school scope. The result then needs isolated TiDB integration coverage for empty install, successful verification, repeat install, interrupted DDL recovery, and runtime repository/authentication/RBAC compatibility.

Until those artifacts and checks are available, use no initialization or migration command against production. Do not record migration 049 as a fresh-database baseline.

## Schema evidence deliverables

The reproducible source evidence is published in [the authoritative-schema status](tidb-authoritative-schema.md), [entity inventory](tidb-schema-entity-inventory.json), [relationship map](tidb-schema-relationship-map.md), and [application coverage matrix](tidb-application-schema-coverage.md). All business entities and historical view candidates remain explicitly unresolved for canonical DDL. Five platform metadata tables have native TiDB DDL in source but have not been checked against a live TiDB server.

[The live-schema verification report](tidb-live-schema-verification.json) records the current check as `NOT_VERIFIED`: the configured URL was rejected before connection and no canonical expected-object set exists. Actual database counts and comparison fields are therefore unknown. Do not treat this report as a successful verification or run initialization until the unresolved schema contract is approved.