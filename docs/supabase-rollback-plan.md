# Supabase reconciliation rollback plan

## Current state

The reconciliation migration has been generated and tested in disposable PGlite only. It has **not** been executed in Supabase; production runtime settings and traffic have not changed. The inspected public starter tables were empty at read-only inspection, but the owner has not confirmed recovery readiness or that the project is non-production. Do not treat this document as authorization to execute SQL or switch traffic.

## Before any future execution

1. Confirm the Dashboard project reference and environment. Obtain owner approval for the migration and verify a restorable pre-migration backup/PITR point. Record the backup timestamp and recovery owner.
   Evidence must identify project ref and region, a restorable point timestamp that predates execution, recovery status/availability, and the authorized recovery operator. Confirm restoration is operationally available (or rehearse into a separate recovery project); a configured retention window by itself does not prove restorability.
2. Re-run the migration preflight inventory and row counts. If any of the seven starter tables is non-empty, the migration must abort; export/reconcile those rows and approve a separate mapping before changing the schema.
3. Preserve the existing TiDB backup and its runtime settings. No source export/import or TiDB retirement is part of this migration.
4. Apply to an isolated non-production project first. Keep `osaah_legacy_20261015`; do not drop it during rollback or cutover.

Do not begin if written approval for the exact target project and schema operation, project classification, or the recovery evidence above is missing. The owner must provide those items; project identity alone is not authorization.

## Failure before commit

All migration statements run in one PostgreSQL transaction. A preflight or DDL failure must leave the transaction uncommitted. In SQL Editor, inspect the error, issue `ROLLBACK` if the session remains in a failed transaction, then rerun the read-only validation queries to confirm the seven tables still exist in `public` and the archive schema was not created. Do not edit the preflight to force it through; resolve the reported drift or use a reviewed migration.

## Rollback after commit, before application writes

Prefer restoring the verified pre-migration backup/PITR point into a separate recovery project, validating its seven-table catalog and policies, then pointing the test deployment back only after the recovery target is confirmed. Keep both the new OSAAH public schema and `osaah_legacy_20261015` intact until recovery is complete. Do not drop either schema as a shortcut.

If no recoverable backup exists, stop. A manual reverse migration would have to move all new OSAAH objects and their dependencies out of `public`, restore the archived objects to `public`, and reconstruct the original grants and RLS policies. Do not improvise that operation in production.

## Rollback after application writes or data import

1. Stop writes by taking the application out of service using the approved deployment process; do not change public traffic until data safety is established.
2. Snapshot the new PostgreSQL records and reconcile any payments, receipts, results, enrollments, attendance, and finance writes with the TiDB backup/source. Preserve exact identifiers and totals.
3. Determine whether changes can be replayed to the prior system without changing business meaning. If not, restore to a separate recovery target and keep the application offline until a reviewed forward fix or recovery decision is approved.
4. Only after reconciliation and owner approval may the previous app/database configuration be restored. Verify login, permissions, parent-child authorization, and critical workflows on the restored target before reopening traffic.

## Release/retirement gate

Do not retire TiDB, remove its database credentials, or delete the archived starter schema until the non-production and production PostgreSQL application workflows, source-to-target reconciliation, backup/recovery, rollback rehearsal, and a separately approved cutover have all passed. Preserve final source backups according to the owner's retention decision.
