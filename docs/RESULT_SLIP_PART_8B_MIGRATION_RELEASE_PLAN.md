# Result Slip Production Migration Release Plan

## Purpose and scope

This plan prepares the dedicated protected workflow at `.github/workflows/apply-result-slip-migrations.yml` for the canonical score and GES Assessment tables. It is limited to migrations 055 and 056, in ascending order. It does not deploy application code, merge a branch, alter Git refs, or restart services.

The workflow is `workflow_dispatch` only. It requires `release_ref` to be exactly a lowercase 40-character commit SHA and requires the exact confirmation phrase `APPLY_RESULT_SLIP_055_056`. It checks out that SHA, verifies the resolved `HEAD` exactly matches the input before proceeding, and reports both values without printing credentials.

## Production protections

The job runs in the existing protected GitHub environment `production`, receives `DATABASE_URL` only through `${{ secrets.DATABASE_URL }}`, and has `contents: read` permission. It checks that the secret is non-empty without echoing it. The migration preflight connects through the repository TiDB adapter and verifies `SELECT DATABASE()` equals exactly `osaahdaylightschool` before any migration DDL.

The workflow is serialized with concurrency group `production-result-slip-migrations` and `cancel-in-progress: false`; its job timeout is 15 minutes. A wrong confirmation, missing release ref, missing secret, wrong database, missing production baseline, missing or invalid migration metadata, unapplied predecessor 054, unresolved pending migration below 055, locked migration state, or out-of-order 056 ledger entry fails before this task's migration DDL.

## Migration definitions and order

`schema/055_canonical_academic_scores.sql` creates `canonical_academic_scores` with `CREATE TABLE IF NOT EXISTS`. Its unique scope is `(school_id, student_id, class_id, academic_year_id, term_id, subject_id)`. Its `student_id` foreign key targets the canonical master `students.id`, not `student_profiles.id`; it also references schools, classes, academic years, terms, and subjects.

`schema/056_canonical_ges_assessments.sql` creates `canonical_ges_assessments` with `CREATE TABLE IF NOT EXISTS`. It stores conduct, attitude, interest, class-teacher remarks, and headteacher remarks. Its unique scope is `(school_id, student_id, class_id, academic_year_id, term_id)` and it uses the same master `students.id` identity contract with school, class, year, and term references.

Both definitions are additive table creation; neither includes `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE`, destructive rename, or replacement. 055 must precede 056 as the declared release order; 056 also requires 055 to be recorded. Required predecessor migration 054 must already be present in the checked migration ledger. Migration 057 is not required or created.

## Ledger and bounded execution

The workflow uses `src/platform/migration-runner.js` and the TiDB adapter in `src/ai/tidb-database-adapter.js`. The runner verifies recorded names and SHA-256 checksums against repository SQL, baseline state, missing migration files, and pending versions. The task-specific `applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] })` method shares the runner’s health checks, ledger inspection, checksum verification, lock acquisition/release, and per-migration transaction callback while executing only the explicit allowlist. Versions above 056 are never selected, even if pending.

The workflow supports both pending, only 056 pending after 055, and both already recorded. It rejects a 056-without-055 ledger gap. It does not overwrite ledger rows to conceal mismatches. Before executing, it checks that the migration lock row is present and not held; the runner then atomically obtains the lock before DDL to address races.

## Schema and ledger postconditions

For any table already present before execution, the preflight validates its runtime-required columns, exact ordered unique-scope index, and foreign-key targets before proceeding. Missing tables are allowed only when the corresponding migration remains unrecorded. After execution it verifies both tables are base tables and validates all required columns, unique indexes, and foreign keys directly through `information_schema`.

The script then runs the repository ledger validation, confirms 055 and 056 have matching recorded names/checksums, and reports the final applied and pending version lists. It never reports `DATABASE_URL` or database credentials. The validation command available for later independent review is `npm run migration:validate`; table postconditions are separately verified by the workflow script.

## Failure and DDL transaction limits

The adapter calls `BEGIN`, `COMMIT`, and `ROLLBACK` around each migration and its ledger insert, but this plan does **not** claim TiDB DDL rollback is guaranteed. Recovery relies primarily on additive, repeat-safe `CREATE TABLE IF NOT EXISTS`, preflight ledger/checksum/database checks, an explicit migration allowlist, a migration lock, and direct postcondition checks. If DDL succeeds but the ledger write does not survive, a subsequent run will recheck the existing table contract before attempting the idempotent migration again. An unexpected or malformed existing table fails preflight for human investigation.

Any failure stops the workflow and emits a safe error code/message. It does not continue to arbitrary later migrations, modify ledger history, merge, deploy, or perform application release actions.

## Execution status

This workflow was **NOT RUN** while preparing Part 8B.1. No production connection was made, production data was not mutated, and migrations 055/056 were not applied. Future invocation remains a separate, reviewed Part 8B.2 production action after the certified branch is synchronized and this workflow is reviewed.
