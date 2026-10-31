# TiDB migration and runtime audit

## Scope and safety

This audit is based on repository files in the isolated `codex/tidb-only-runtime` checkout. No production database was queried or changed. The schema inventory is generated from numbered SQL files and lexical source references; it is not a live catalog export. The existing 82 migration files contain repeated and evolving definitions, so the inventory preserves migration provenance rather than claiming an authoritative final shape.

## Findings preventing a complete TiDB-only migration

- The historical schema set mixes SQLite constructs (`PRAGMA`, `INSERT OR IGNORE`, `TEXT PRIMARY KEY`) with later MySQL/TiDB DDL. It cannot be replayed as a uniform TiDB bootstrap without per-migration conversion and validation.
- The generic migration runner applies each migration inside a transaction. TiDB DDL implicitly commits, so rollback cannot guarantee restoration of a partially applied migration. A failed migration may leave DDL applied without its ledger record.
- Several runtime modules still execute PostgreSQL `ON CONFLICT ... EXCLUDED` statements through durable database abstractions. These include admission enrollment, existing-student linking, auth rate limits, fee collection, durable academic defaults, announcements, result blocking, sample fixture persistence, and school settings. The result-blocking path also uses an expression conflict target.
- Schema history includes duplicate and conflicting table definitions. A truthful current database baseline and read-only comparison are required before any reconciliation plan can safely identify missing or incompatible objects.

## Parent SMS authentication

The TiDB-only parent OTP routes and service are added behind the configured SMS runtime and TiDB durable-session adapter. The service stores an HMAC digest, applies database-backed phone/IP throttling, limits code attempts, consumes challenges once, rechecks parent/student eligibility, and returns server-derived identity. OTP delivery requires the configured SMS provider and `OSAAH_PARENT_OTP_HMAC_SECRET` (at least 32 characters). No live provider or production identity was exercised here.

## Migration execution status

`schema/082_parent_sms_auth.sql` is an additive migration for OTP challenge and rate-limit tables. It is not applied. The repository's standard migration apply workflow is not safe for production until migration execution handles TiDB DDL commit semantics and all migrations/runtime SQL have a verified TiDB compatibility path. The existing readiness checks are read-only and do not establish schema readiness by writing metadata.

## Safe next steps

1. Export the live TiDB table, column, key, index, and foreign-key metadata with a read-only account and reconcile it against this inventory.
2. Convert historical DDL into a reviewed TiDB bootstrap/reconciliation plan, including explicit treatment of duplicate definitions and seed data.
3. Make migration execution DDL-aware: execute each DDL statement with durable progress/verification semantics rather than promising transactional rollback.
4. Port and test each runtime upsert against TiDB semantics, including uniqueness and concurrent requests.
5. Apply only an explicitly reviewed migration allowlist after isolated TiDB validation and a recovery plan.