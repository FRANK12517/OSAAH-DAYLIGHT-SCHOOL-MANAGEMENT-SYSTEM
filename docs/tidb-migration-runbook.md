# TiDB migration runbook

## Current status

The generic migration runner now tracks a per-version checksum and run state (`RUNNING`, `FAILED`, `COMPLETED`) for the TiDB adapter. A TiDB run starts before SQL execution; the applied ledger is written after SQL and verification callbacks; completion is recorded last. An unresolved `RUNNING` or `FAILED` row blocks retries. TiDB DDL may commit independently, so the runner does not claim DDL rollback.

The current `scripts/migrate.mjs apply` path does not yet have reviewed postcondition verifiers for every historical migration. The repository migration set is mixed-dialect and is not safe to apply wholesale to a production database. Do not use the generic apply command against production until the explicit per-migration plan and verifiers are complete.

Migration 083 adds the unique logical result-block scope `(school_id, academic_year, term, class_id, result_type, IFNULL(mock_examination,''), student_id)`. Before an approved attempt, run `preflightResultBlocking083` from `src/platform/result-blocking-083-preflight.js` through a read-only TiDB adapter. It reports at most 100 duplicate scope groups and stops before DDL when any exist. Reconcile duplicates through a separately reviewed, auditable data repair that preserves the authoritative block decision; do not delete or merge rows automatically. Re-run the read-only preflight and confirm it returns zero groups before the explicit migration allowlist is approved. The generic migration command intentionally has no 083 verifier and will refuse TiDB execution without one.

## Required preparation

1. Confirm the database is `osaahdaylightschool` and the server identifies as TiDB.
2. Take and verify a TiDB Cloud backup/restore point before any approved DDL.
3. Use read-only `migration:status`, readiness, and schema inventory reports to establish actual baseline state.
4. Review only an explicit allowlist of migrations with predecessor, schema preconditions, data checks, DDL postconditions, and recovery instructions.
5. Test the exact migration against a disposable TiDB environment running the same TiDB version and representative schema/data.

## Run state and recovery

- `COMPLETED`: compare the run checksum to both the repository migration and applied ledger. Any mismatch is a hard stop.
- `RUNNING`: the process stopped before recording an outcome. Inspect every statement’s postcondition in `information_schema` and any data-level preconditions. Do not rerun automatically.
- `FAILED`: inspect the sanitized error code and actual schema. DDL already completed remains committed. Determine which statements took effect, apply only missing idempotent operations through an approved recovery plan, verify all postconditions, then use a reviewed recovery procedure to reconcile the run and applied ledgers.
- A missing/partial object is not permission to rerun a complete file. Statements such as `ADD CONSTRAINT`, index replacement, data backfills, and seed inserts need operation-specific recovery.

## Concurrency and metadata

The TiDB adapter uses a single-row migration lock with a conditional update and affected-row check. It serializes runners that use this metadata protocol. Do not manually edit the lock or run a second tool that bypasses it. Run metadata creation itself is DDL and must be performed in a reviewed initialization window.

## Rollback and restoration

Do not use SQL rollback as a recovery promise for committed DDL. Prefer a forward repair migration after backup and verification. For a migration whose effects cannot be safely reversed, restore into a separate recovery cluster from the verified backup, validate application compatibility there, and follow the separately approved cutover plan. No cutover or production DDL is authorized by this runbook.

## Commands

Local syntax and migration discovery:

```powershell
npm run migration:validate
```

Read-only production status requires configured access and a trusted environment:

```powershell
npm run migration:status
```

Do not run `npm run migration:apply` on production until the blockers above are closed and a separately reviewed change authorizes the exact migration scope.
