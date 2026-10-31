# OSAAH Daylight authoritative TiDB schema

> **Release status: NOT AUTHORITATIVE; fresh initialization is not enabled.** No complete canonical TiDB DDL plan is present in this repository state. This document records confirmed runtime facts and the evidence required before DDL can be approved.

## Confirmed application constraints

- Database: `osaahdaylightschool`.
- Single-school identity: `sch_default_01`; no additional school scope is introduced by this schema work.
- Production adapter: explicit TiDB selection through mysql2 with TLS verification enabled.
- Runtime source scan: 153 source files, 543 SQL observations, 71 statically SQL-confirmed table names, and 134 write-column observations.
- Current numbered repository SQL: 82 files. These historical migrations are not, by themselves, a reviewed fresh-install plan.

## Evidence status

The entity inventory contains 164 historical/runtime table names and 8 historical view names. Runtime query evidence, historical DDL, and parallel PostgreSQL definitions are kept in separate evidence fields. 5 platform metadata tables have native TiDB DDL in source but are not live-verified; 159 application/historical objects remain unresolved for canonical DDL.

The relationship map contains 400 historical foreign-key candidates and 127 runtime JOIN observations. Neither set is treated as a TiDB constraint without field-level and lifecycle review.

## Required artifacts

- [Entity inventory](tidb-schema-entity-inventory.json) keeps source-linked runtime observations and historical definitions separate.
- [Per-object reconciliation ledger](tidb-schema-reconciliation.json) records every original application table and historical view.
- [Relationship map](tidb-schema-relationship-map.md) distinguishes historical FK candidates from runtime joins.
- [Application coverage](tidb-application-schema-coverage.md) tracks domain requirements and unresolved work.
- [Fresh initialization safety](tidb-fresh-initialization.md) documents the fail-closed runner and current absence of an approved plan.

## Decisions still required before an authoritative schema can be published

- users uniqueness/nullability/defaults and cross-school identifier policy unresolved.
- user_roles primary-key/type choice and FK contract unresolved although id writes and pair uniqueness behavior are established.
- RBAC seeding/scope and empty-permission fallback authorization policy unresolved.
- TiDB FK/type/action contract unresolved.
- portal_users lacks TiDB DDL/provisioner.
- separate proprietor login does not establish standard durable session.
- secure bootstrap policy must be implemented as an explicit operational workflow.
- staff_profiles writer/history shape conflict.
- staff_number is externally supplied and school-scoped in application checks; physical uniqueness/FK not established.
- teacher assignment contracts remain table-specific.
- link archival/guardian policy unresolved.
- legacy student identity bridges remain.
- physical types, FKs and delete actions unresolved.
- historical schema drift across academic modules.
- scoped key and FK contracts need full per-table reconciliation.
- class_subjects is optional compatibility only.
- assessment/result stores have parallel historical shapes.
- score precision, uniqueness, version, and FK contracts require field-level reconciliation.
- legacy/current result sources coexist.
- view/result reconciliation inputs need canonical selection.
- generated uniqueness migration needs target-version validation.
- conflicting historical fee view definitions.
- amount precision/minor-unit contracts and payment allocation constraints not fully reconciled.
- view dependencies need canonical base-table definitions.
- dynamic/reporting dependencies incompletely traced.
- historical class views lack current direct consumers.
- 92 historical tables lack sufficiently evidenced dispositions.
- Confirm the actual TiDB target version and the deployment SQL mode, charset/collation, time zone, and foreign-key enforcement policy.
- Reconcile every active repository query with its current table/column contract, including dynamic SQL and query paths not captured by static extraction.
- Approve incompatible historical definitions only after tracing current writers, readers, test expectations, and data-retention behavior.
- Verify DDL, indexes, constraints, views, timestamp behavior, JSON, generated-column indexes, and transaction/recovery behavior on the target TiDB release.

## Migration policy

No new canonical application DDL migration is published from this evidence set. Do not replay historical migrations against an empty TiDB database or use the unresolved inventory as DDL. The next schema version is intentionally unassigned until an approved, complete manifest and its postcondition tests exist.

The code in `src/platform/tidb-fresh-initializer.js` remains a safety mechanism for a future reviewed canonical plan; it is not itself proof that the application schema is complete.
