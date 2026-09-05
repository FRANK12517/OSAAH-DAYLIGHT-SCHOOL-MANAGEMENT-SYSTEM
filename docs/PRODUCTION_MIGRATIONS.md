# Production Migration Runbook

The migration runner discovers numeric `.sql` files from `schema/`, validates immutable SHA-256 checksums, records applied migrations through the configured durable adapter, and serializes execution with a database-backed migration lock. It does not contain credentials or select a database vendor.

## 1. Backup prerequisite

Before production apply, the database owner must confirm a recent recoverable backup, the restore location, the responsible operator, and the recovery point/time objectives. Do not run migrations when backup or connection health is uncertain.

## 2. Migration status and validation

Configure `OSAAH_DATABASE_ADAPTER_MODULE` to the approved server-side adapter module. Credentials remain in the deployment secret manager and are resolved by that adapter.

- `npm run migration:validate` validates filenames and ordering without a database when no adapter is configured. With an adapter, it also checks durable history and checksums.
- `npm run migration:status` performs a connection-health check and lists applied and pending migrations without changing schema.

Confirm that `018_ai_audit_logs.sql` and `022_ai_human_controlled_actions.sql` appear in the expected status. A missing previously applied file or changed checksum is a blocking error.

## 3. Apply

Run `npm run migration:apply` once from the controlled deployment job. The runner acquires the adapter's database-backed lock and applies each pending migration in numeric order inside a transaction where supported. A second concurrent runner fails closed.

## 4. Verification

Run `npm run migration:status` again. Confirm no unexpected pending migration, inspect the deployment job result, verify application/database health, and run the production-safe smoke checks. Never insert demo records for verification.

## 5. Rollback and recovery

Existing migrations are forward-only and are not automatically reversed. If an apply fails, the current migration transaction rolls back. If the database cannot recover transactionally or a committed migration causes a critical failure, disable AI with `OSAAH_AI_ENABLED=false`, stop further deploys, restore the approved backup according to the database provider's recovery procedure, and redeploy the last known-good commit. Never edit the checksum or contents of an already-applied migration to simulate rollback; create a reviewed forward repair migration instead.
