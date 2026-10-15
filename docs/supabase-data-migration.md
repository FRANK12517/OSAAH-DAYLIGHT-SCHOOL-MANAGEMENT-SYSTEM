# Supabase data migration and cutover procedure

This runbook does not authorize connecting to or modifying production. Project `douzohkmnuqwbpwcezke` was not accessed. Rehearse only on a disposable PostgreSQL target. Do not cut over until the server adapter/repositories and access checks in `supabase-migration-audit.md` pass.

**Current status (2026-10-15):** the baseline and selected application paths have PGlite coverage. The actual Node `pg` harness on `osaah_test_local01` passes 14/14: five adapter/schema checks plus nine rollback-only database workflow probes. The latest Node 24.19.0 suite passes 1,445/1,445, including three read-only snapshot reconciliation tests. Existing unit/HTTP fixture tests and PGlite checks complement the live database probes, but do not equal full application end-to-end coverage. The inventory reports 63 files, 92 groups and 439 lexical occurrences and is not proof of compatibility. No production TiDB backup, data transfer, hosted Supabase auth/RLS verification, staging deployment, or cutover occurred. Do not treat the migration as production-ready.

The subsequent local actual-driver run passed all 14 harness checks, including nine rollback-only database workflow probes. The latest full Node 24.19.0 test suite passes 1,445/1,445. These checks cover database/schema operations with synthetic rows and do not exercise every application HTTP/service workflow. No production source snapshot, target import, hosted Supabase authentication/RLS test, staging deployment, or production cutover has occurred.

## Source TiDB inventory access and safe procedure

The local environment inspection for this continuation found `.env.local` contains only a `DATABASE_URL` pointing to `localhost/osaah_test_local01`; no TiDB/MySQL URL or hosted non-production Supabase URL/key is configured. The URL value and credentials were not printed. No source or hosted database connection was attempted. The missing prerequisite for source inspection is an authorized, read-only TiDB connection string (or an operator-generated inventory export) supplied through a temporary process environment variable such as `OSAAH_TIDB_READONLY_URL`; it must be verified to resolve to the intended non-production/source host before use. Do not put it in a committed file.

When an authorized read-only connection is available, run only metadata `SELECT`s first. Confirm the selected database and server identity using `SELECT DATABASE(), VERSION(), @@hostname, @@read_only;`. Then capture the deployed migration ledger (`SELECT * FROM schema_migrations ORDER BY version;` after verifying the table exists), and inventory objects and definitions with:

```sql
SELECT TABLE_NAME, TABLE_TYPE, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_TYPE, TABLE_NAME;

SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
       SUB_PART, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME;

SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME,
       REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, VIEW_DEFINITION
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING,
       ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;
```

Generate per-table row-count and primary-key export queries from the metadata above, review the generated identifiers against the inventory, and execute only `SELECT COUNT(*)` and ordered key projections. Do not use a generic dynamic SQL routine on the source. Capture database/table identity, timestamp, query text, and checksums for the operator-approved export; redact credentials and personal data from logs. This inventory is not a data export or backup and does not substitute for a consistent, encrypted provider snapshot.

## Repeatable disposable source-to-target reconciliation

Do this only after a separately authorized consistent TiDB snapshot has been restored to an isolated source rehearsal and a disposable PostgreSQL rehearsal has the reviewed baseline. Never point these steps at production. Export data from the restored copy, transform it with a versioned mapping manifest, and import into a newly created disposable target; retain a run ID, source snapshot checksum, mapping/code revision, and target migration checksum. Do not rerun the baseline or clear a target containing data.

For every mapped table, compare source and target row counts, null counts, and primary-key sets (including missing/extra keys, not just totals). Validate all declared FKs and unique constraints and report orphan/duplicate rows without auto-repair. Compare date-only values exactly; for instants compare normalized UTC values and separately test Ghana-local date boundaries. Compare result record counts, subject/assessment totals and published-state keys; payment references, amounts, receipts and payment-to-receipt links; and finance income/expense/ledger aggregates by school, period, currency/unit, and category. Keep Fee Hub decimal currency and integer minor-unit collections distinct. Verify student master/profile/parent-link mappings, enrollment current-row scope, and that sequence next-values exceed all allocated IDs. Emit a machine-readable reconciliation report containing counts and keyed differences, never credentials or unnecessary personal fields. Require every difference to be explained and approved; do not synthesize balancing or missing records.

The repository now includes `npm run database:reconcile-snapshots`, a read-only JSON snapshot comparator. It compares row counts, primary-key definitions and hashed key sets, duplicate and missing/extra keys, declared target foreign-key integrity, explicitly declared date/timestamp conversions, and selected numeric aggregates. It emits only hashed primary-key identifiers in differences and returns exit code 2 on mismatches. It never connects to a database or modifies snapshots. It is a comparison utility, not a TiDB exporter, data transformer/importer, SQL constraint inspector, or proof that a migration ran. Operators must generate reviewed snapshots from an isolated source restore and disposable PostgreSQL target using the manifest format documented below; configure each table's primary key, FK, date/timestamp, and aggregate fields explicitly. Missing source table metadata is reported rather than inferred.

Example snapshot table definition: `{"metadata":{"runId":"rehearsal-001"},"tables":{"students":{"primaryKey":"id","rows":[{"id":"synthetic-id","created_at":"2026-10-15T12:00:00Z"}],"timestampColumns":["created_at"]}}}`. Run `npm run database:reconcile-snapshots -- source-snapshot.json target-snapshot.json report.json`; the report destination must not already exist, to avoid overwriting evidence. Snapshot files may contain sensitive records and must remain in an access-controlled, approved workspace; never commit them. No actual source or target snapshot was available or reconciled in this task.

## Remaining cutover gates (ordered)

1. **Source evidence and recoverability:** obtain the operator-approved full TiDB schema/migration-ledger inventory, consistent encrypted backup and logical export; restore the backup into an isolated source rehearsal and verify recovery. The earlier empty Supabase information-schema result covers only the inspected queries and does not establish that the eventual production target is empty.
2. **Data reconciliation:** map and transfer a disposable copy in dependency order, preserve IDs/session hashes and exact money/date semantics, then reconcile table counts, primary-key sets, nulls, FK/unique constraints, student/profile/parent links, enrollment and sequence counters, results, payment/receipt totals and finance aggregates. No production records have been transferred.
3. **Application-path verification:** exercise the actual HTTP/service paths for authentication and revocation; admission documents/enrollment; parent-linked student access and promotion; student/staff attendance; terminal/JHS mock save, publication and result slips; Fee Hub/payment receipt/finance; staff permissions/class assignment; announcements/SMS; and exports/jobs. Current new `pg` workflow tests are SQL-level transactional probes, not nine full end-to-end suites.
4. **Supabase security verification:** on an authorized non-production Supabase project, test server-managed signed-cookie auth, session revocation, server-only credentials, service-role handling and every anon/authenticated RLS boundary. Local PostgreSQL role grants and `SET ROLE anon` do not emulate Supabase JWT claims, hosted policies, edge settings or network TLS.
5. **Operational approval and cutover:** stage the PostgreSQL-configured application, run the reconciled workflows, approve the write freeze and rollback operators, and separately authorize environment/traffic changes. Production connection changes and deployment are outside this work.

For baseline CLI rehearsal use `OSAAH_POSTGRES_URL` as described above. For the actual Node `pg` integration harness use only the separate `OSAAH_PG_INTEGRATION_URL` plus the exact acknowledgement below. Do not point legacy `npm run migration:*` commands at PostgreSQL.

Application runtime configuration: set `OSAAH_POSTGRES_URL` to the PostgreSQL connection URL in the local process environment (for example, `$env:OSAAH_POSTGRES_URL='postgresql://…'` in PowerShell) or the platform's server-only secret store. Start locally with `npm start` after setting that variable. Direct `node src/server.mjs` startup now fails with a safe error if it is missing, invalid, or conflicts with a different `DATABASE_URL`. Do not set `OSAAH_DATABASE_ADAPTER_MODULE` for application runtime; custom adapter selection is intentionally unsupported. Keep any TiDB URL in an operator-only environment used exclusively by the standalone legacy maintenance commands, never in the application process. Do not expose either database URL to frontend variables.

## Disposable PostgreSQL integration harness

The harness requires PostgreSQL 15 or newer and the repository's installed `pg` dependency (currently `pg` 8.x). It connects only to loopback hostnames (`localhost`, `127.0.0.1`, or `::1`), requires a database name beginning `osaah_test_`, refuses names resembling production/Supabase, and requires an explicit disposable-database acknowledgement. It applies the baseline only to an empty `public` schema. It records the migration checksum in a private RLS-enabled marker and allows repeat runs only when the schema relation names/types exactly match that baseline and the checksum is unchanged. It never drops, truncates, or resets anything. Use a new database to rehearse a changed baseline.

Create a dedicated local PostgreSQL cluster/database with an administrator. The baseline's limited public school read policy refers to the PostgreSQL roles `anon` and `authenticated`; on a local-only disposable cluster, create these roles if absent. Example administrative SQL (run only on the dedicated local cluster):

```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE DATABASE osaah_test_local01;
```

Connect as an owner of `osaah_test_local01` (the harness user needs permission to create tables, indexes, constraints, views, temporary tables and policies in that database, and to grant/revoke table access to the pre-existing API roles). Supply the connection URL only in the test process environment. The URL below is a placeholder, not a credential:

```powershell
$env:OSAAH_PG_INTEGRATION_URL = 'postgresql://<local-user>:<local-password>@localhost:5432/osaah_test_local01'
$env:OSAAH_PG_INTEGRATION_DISPOSABLE = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE'
npm run test:integration
```

`npm run test:postgres:integration` is an equivalent explicit name for the same runner.

The harness applies `supabase/migrations/202610150001_osaah_daylight_schema.sql` to an empty database and runs actual-driver checks for baseline catalog/seed, bind parameters, `RETURNING`, row counts, boolean/JSONB/date/timestamptz/numeric round trips, unique and FK SQLSTATEs, transaction rollback, pool queries, and the anon RLS boundary. The test adapter disables SSL only for the loopback URL; the normal adapter default continues to require certificate-verified SSL. It outputs the database name, migration checksum, and check names, never the URL or password. Any missing server, role, environment value, safety gate, or failed check exits nonzero. To repeat, have the local administrator create a new uniquely named `osaah_test_*` database after inspecting the target; the harness will reject any schema that does not exactly match the marked baseline. To clean up, stop using the exact disposable database, verify its name and host in the local administrative console, then have the administrator drop that specifically named test database. Do not use a wildcard cleanup command.

This real-driver harness does not establish nine complete application workflow suites. Current business coverage by family is catalogued in the audit: selected PGlite flows, existing unit/API regressions, and nine database-level probes are useful evidence, but the probes do not invoke the complete application HTTP/service stacks. Full real-server application workflow coverage remains outstanding.

## Inventory and backup

1. Record the deployed source commit, TiDB/MySQL version, migration ledger and applied versions. Run read-only inventories for tables, columns, indexes, FKs, views, triggers/routines, row counts, and storage references. The supplied empty `information_schema` result applies only to the queried schemas/rows and is not proof that all objects are absent.
2. Compare production inventory to `docs/CURRENT_RUNTIME_DATABASE_REQUIREMENTS_MANIFEST.md` and `schema/001`–`schema/081`. Document production-only columns and duplicate/orphan conditions. Verify the migration-028 admission FK targets master `students.id`, while parent links retain profile IDs.
3. Take a provider-native consistent snapshot and logical exports. Encrypt them, restrict access, record file checksums, and restore the snapshot into an isolated database to verify recoverability. Retain a read-only source until rollback is no longer needed.
4. Agree on write freeze and cutover window. Record source high-water marks and stop scheduled writers/outbound senders before the final snapshot.

## Rehearse PostgreSQL schema and adapter

1. Create a disposable database, apply `supabase/migrations/202610150001_osaah_daylight_schema.sql`, then run `docs/supabase-validation.sql`. The script includes catalog inventories and a rollback-only nullable mock-label uniqueness check. Verify FK, unique, and check failures, role grants/RLS using `anon`/`authenticated`, view queries, and rollback behavior.
2. Before data transfer, resolve any remaining confirmed PostgreSQL incompatibilities in runtime paths. Keep TiDB-only maintenance/source-extraction scripts isolated and retain `mysql2` while they are needed. The adapter is not a MySQL dialect translator. Test login, session revoke/expiry, enrollment ID allocation, row locks, idempotency, payment/receipt transaction rollback, promotion, score writes, and parent/staff authorization through application paths.
3. Map types intentionally: tiny flags to boolean; JSON text to jsonb only after parsing all non-null values; date-only facts to `date`; timestamps to UTC `timestamptz`; exact currency to numeric or existing integer minor units. Preserve source identifiers verbatim. Set database sessions to UTC and validate Ghana-local display boundaries.
4. Import a disposable copy in dependency order: schools/catalogs/years/terms/users/RBAC; students/profiles; parents; staff; admissions/enrollment; academics/attendance; fee setup/obligations/collections/accounts/ledger/invoices/payments/receipts; finance; communication and remaining modules. Validate FKs after load.

## Reconcile without fabrication

For each table compare counts and primary-key sets; compare null counts, date ranges, scoped aggregates, money totals, and child-parent joins. Do not delete, infer, or fabricate records to make counts match. Resolve source duplicates/orphans with a separately reviewed business process.

Specific checks:

- Student IDs have separate layers: master `students.id`, `student_profiles.id`, profile `student_master_id`, Permanent Student ID, and enrollment ID. Keep mappings intact.
- Verify `parent_student_links.student_id` uses profile IDs; admission `student_id` uses master IDs. Preserve active link status. Never grant parents access using school ID alone.
- Check `student_id_sequences` against allocated IDs. Do not reset/decrement counters or reuse an identifier; next sequence must exceed existing values.
- Check one current enrollment per expected class/year/term scope and preserve completed history/promotion context.
- Check result score uniqueness for terminal and each JHS mock scope, published lifecycle, result blocks, and signature links.
- Preserve unknown attendance provenance as unknown/`LEGACY_UNSPECIFIED`; do not infer status, source, reason, actor, or academic period.
- Keep collection integer minor units distinct from Fee Hub decimal amounts. Reconcile invoice/payment/receipt links and sums; never create balancing records.
- Preserve password hashes and hashed session data. Never export raw session tokens. Apply any session invalidation policy only after explicit operational approval.

## Cutover

1. Confirm verified backups and successful disposable rehearsal. Deploy the PostgreSQL-compatible app to staging first, using server-only secrets; ensure no service role key enters `public/`, static assets, or frontend variables.
2. During the separately approved window, put the app in maintenance/read-only mode, stop writers, take a final source snapshot/export, and apply the baseline only to a confirmed empty target. For an existing target, create a separately reviewed additive reconciliation; do not rerun this baseline blindly.
3. Transfer data, validate every FK and unique constraint, reconcile counts/keys/money/dates, then verify server auth, parent linked-student access, staff permissions/class assignment, admissions enrollment, attendance, score entry/results, Fee Hub, payment receipts, communication delivery, and operational logs in staging.
4. Production connection changes/deployment require a separate approved change. Keep credentials server-side, switch only after checks pass, and re-enable writes last. This task does not perform that change.

## Rollback

If a security or integrity gate fails, stop writes and route back to the source. Restore the source snapshot if it received partial writes. Do not reverse-drop a target schema to erase data; preserve it for comparison. Reconcile post-cutover writes through an explicit forward data process before retrying. Record times, commits, counts, checksums, and operator decisions.

## Sign-off

- [ ] Restorable source backup verified.
- [ ] Full source object inventory and migration ledger reconciled.
- [ ] PostgreSQL adapter/repositories and application integration tests pass.
- [ ] Foreign keys, uniqueness, types, dates, money, and sequences reconcile.
- [ ] Browser roles cannot read private tables; parent/staff boundaries pass.
- [ ] Business owner approves maintenance, cutover, and rollback operators.
