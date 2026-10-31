# Reports, Notifications and Auditing database contract

> Status: **PARTIAL**. This is an evidence reconstruction, not approved canonical TiDB DDL. Historical types/constraints are candidate evidence only.

## Scope and runtime evidence

Target database: `osaahdaylightschool`; school scope: `sch_default_01`.
Primary current-code and schema references: [src/ai/operational-intelligence.js](../../src/ai/operational-intelligence.js), [src/durable-announcements.js](../../src/durable-announcements.js), [src/platform/final-result-slip-reconciliation.js](../../src/platform/final-result-slip-reconciliation.js), [src/single-school-overview.js](../../src/single-school-overview.js).
The operation summary below is read/join/insert/update/delete counts extracted from current source SQL. Samples include source line and SQL prefix. Dynamic SQL, indirect calls, and feature-gated branches may not be fully captured.

## Observed application contract

- Runtime modules write audit logs and announcement/notification records; reporting and dashboard access is spread across service modules and authorization routes.
- The class database views have historical definitions but no confirmed current direct runtime SELECT. A full module/feature-gate review is still needed to distinguish supported reporting from retired history.

## Table evidence matrix

| Table | Evidence class / disposition | SQL ops R/J/I/U/D | Runtime write columns | Runtime read projections | Historical type candidates (not canonical) | SQL samples | Source modules |
|---|---|---:|---|---|---|---|---|
| `audit_logs` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/2/0/0 | No INSERT/UPDATE columns extracted | action,entity,occurred_at AS occurredAt,user_id AS userId,role_id AS roleId | id:TEXT, school_id:TEXT, user_id:TEXT, role_id:TEXT, action:TEXT, entity:TEXT, entity_id:TEXT, previous_value:TEXT, new_value:TEXT, ip_address:TEXT, session_id:TEXT, device_metadata:TEXT | INSERT src/admission-enrollment.js:124 [INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)]<br>INSERT src/existing-student-linking.js:150 [INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)]<br>READ src/single-school-overview.js:49 [SELECT action,entity,occurred_at AS occurredAt,user_id AS userId,role_id AS roleId FROM audit_logs WHERE school_id=? ORDER BY occurred_at DESC LIMIT 10] | [src/admission-enrollment.js](../../src/admission-enrollment.js), [src/existing-student-linking.js](../../src/existing-student-linking.js), [src/single-school-overview.js](../../src/single-school-overview.js) |
| `announcements` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | title,created_at AS createdAt | id:TEXT, school_id:TEXT, title:TEXT, body:TEXT, audience:TEXT, class_id:TEXT, student_ids_json:TEXT, emergency:INTEGER, sender_id:TEXT, created_at:TEXT | READ src/single-school-overview.js:47 [SELECT title,created_at AS createdAt FROM announcements WHERE school_id=? ORDER BY created_at DESC LIMIT 5] | [src/ai/capabilities/core.capability.js](../../src/ai/capabilities/core.capability.js), [src/ai/operational-intelligence.js](../../src/ai/operational-intelligence.js), [src/ai/tidb-readiness.js](../../src/ai/tidb-readiness.js), [src/auth.js](../../src/auth.js), [src/communication.js](../../src/communication.js), [src/durable-announcements.js](../../src/durable-announcements.js), [src/module-registry.js](../../src/module-registry.js), [src/parent-dashboard.js](../../src/parent-dashboard.js), [src/proprietor-sidebar-routes.js](../../src/proprietor-sidebar-routes.js), [src/sample-fixture-repository.js](../../src/sample-fixture-repository.js), [src/server.mjs](../../src/server.mjs), [src/sidebar-classification.js](../../src/sidebar-classification.js), [src/single-school-overview.js](../../src/single-school-overview.js) |
| `announcement_records` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 2/0/1/1/0 | published_at, status, updated_at | a.id,a.school_id AS schoolId,a.title,a.message,a.priority,a.recipient_category AS recipientCategory,a.status,a.scheduled_for AS scheduledFor,a.published_at AS publishedAt,a.sender_id AS senderId,a.created_at AS createdAt,u.username AS senderName,r.role_key AS senderRole,ar.read_at AS readAt; id | id:VARCHAR(64), school_id:VARCHAR(64), title:TEXT, message:TEXT, priority:VARCHAR(32), recipient_category:VARCHAR(32), status:VARCHAR(32), scheduled_for:VARCHAR(64), published_at:VARCHAR(64), sender_id:VARCHAR(64), created_at:VARCHAR(64), updated_at:VARCHAR(64) | INSERT src/durable-announcements.js:50 [INSERT INTO announcement_records (id,school_id,title,message,priority,recipient_category,status,scheduled_for,published_at,sender_id,created_at,updated_at) VALU]<br>READ src/durable-announcements.js:59 [SELECT a.id,a.school_id AS schoolId,a.title,a.message,a.priority,a.recipient_category AS recipientCategory,a.status,a.scheduled_for AS scheduledFor,a.published_]<br>READ src/durable-announcements.js:63 [SELECT id FROM announcement_records WHERE school_id=? AND status='SCHEDULED' AND scheduled_for<=?]<br>UPDATE src/durable-announcements.js:63 [UPDATE announcement_records SET status='PUBLISHED',published_at=?,updated_at=? WHERE school_id=? AND id=? AND status='SCHEDULED'] | [src/durable-announcements.js](../../src/durable-announcements.js) |
| `notifications` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | type,title,status,created_at AS createdAt | id:TEXT, school_id:TEXT, type:TEXT, recipient_id:TEXT, student_id:TEXT, title:TEXT, body:TEXT, status:TEXT, created_at:TEXT, created_by:TEXT | READ src/single-school-overview.js:48 [SELECT type,title,status,created_at AS createdAt FROM notifications WHERE school_id=? ORDER BY created_at DESC LIMIT 5] | [src/communication.js](../../src/communication.js), [src/module-registry.js](../../src/module-registry.js), [src/proprietor-sidebar-routes.js](../../src/proprietor-sidebar-routes.js), [src/server.mjs](../../src/server.mjs), [src/single-school-overview.js](../../src/single-school-overview.js) |

## Views

| View | Definition migrations | Dependencies | Disposition / finding |
|---|---|---|---|
| `vw_class_database` | 038_canonical_class_database_fee_hub.sql | student_enrollments, students | UNRESOLVED; SINGLE_HISTORICAL_DEFINITION_NOT_LIVE_VERIFIED |
| `vw_completed_class_database` | 038_canonical_class_database_fee_hub.sql | student_enrollments, students | UNRESOLVED; SINGLE_HISTORICAL_DEFINITION_NOT_LIVE_VERIFIED |

## Per-object unresolved evidence

### audit_logs

- Historical key/index/FK candidates (not canonical): PK id; INDEX idx_audit_entity(entity, entity_id); INDEX idx_audit_occurred_at(occurred_at); FK school_id → schools(id); FK user_id → users(id); FK role_id → roles(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/admission-enrollment.js, src/existing-student-linking.js, src/single-school-overview.js

### announcements

- Historical key/index/FK candidates (not canonical): PK id; FK school_id → schools(id); FK class_id → classes(id); FK sender_id → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/ai/capabilities/core.capability.js, src/ai/operational-intelligence.js, src/ai/tidb-readiness.js, src/auth.js, src/communication.js, src/durable-announcements.js, src/module-registry.js, src/parent-dashboard.js, src/proprietor-sidebar-routes.js, src/sample-fixture-repository.js, src/server.mjs, src/sidebar-classification.js, src/single-school-overview.js

### announcement_records

- Historical key/index/FK candidates (not canonical): PK id; INDEX idx_announcement_due(school_id, status, scheduled_for); FK school_id → schools(id); FK sender_id → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/durable-announcements.js

### notifications

- Historical key/index/FK candidates (not canonical): PK id; INDEX idx_notifications_recipient(school_id, recipient_id, status); INDEX idx_notifications_student_created(school_id, student_id, created_at); FK school_id → schools(id); FK recipient_id → users(id); FK student_id → student_profiles(id); FK created_by → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/communication.js, src/module-registry.js, src/proprietor-sidebar-routes.js, src/server.mjs, src/single-school-overview.js

### View vw_class_database

- Missing: No authoritative current application query contract selects a canonical output shape.
- Missing: Base-table physical definitions and exact joins, filters, null behavior, aggregation, and aliases are not reconciled across migrations.
- Missing: No isolated target-version TiDB view creation/query validation exists.
- Insufficient because: Historical view definitions conflict and the runtime reconciler checks metadata/shape but does not establish which query is the approved current business contract.
- Required decision/evidence: Product owner must confirm a supported workflow or provide evidence to retire the historical view; absence of direct SELECT is insufficient.
- Affected source/workflow evidence: No current direct consumer identified.

### View vw_completed_class_database

- Missing: No authoritative current application query contract selects a canonical output shape.
- Missing: Base-table physical definitions and exact joins, filters, null behavior, aggregation, and aliases are not reconciled across migrations.
- Missing: No isolated target-version TiDB view creation/query validation exists.
- Insufficient because: Historical view definitions conflict and the runtime reconciler checks metadata/shape but does not establish which query is the approved current business contract.
- Required decision/evidence: Product owner must confirm a supported workflow or provide evidence to retire the historical view; absence of direct SELECT is insufficient.
- Affected source/workflow evidence: No current direct consumer identified.

## Contract status and unresolved requirements

- dynamic/reporting dependencies incompletely traced
- historical class views lack current direct consumers
- 92 historical tables lack sufficiently evidenced dispositions
- Exact SQL types, lengths/precision, nullability, defaults, primary/unique/index constraints, FK actions, charset/collation, and target-version compatibility remain unresolved unless a specific field is established by runtime behavior. The manifest preserves operation-level evidence; this document does not infer a full definition from a historical CREATE TABLE.
- Decisions requiring business-owner approval: identifier lifecycle, uniqueness scope, retention/deactivation, authorization policy, and clean-install workflow choices listed above.

## Validation evidence

- Relevant automated tests are recorded in the phase report and repository test suite; those tests validate application behavior, not a live TiDB schema.
- No production database was queried and no DDL was executed.
