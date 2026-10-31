# Results and Report Cards database contract

> Status: **PARTIAL**. This is an evidence reconstruction, not approved canonical TiDB DDL. Historical types/constraints are candidate evidence only.

## Scope and runtime evidence

Target database: `osaahdaylightschool`; school scope: `sch_default_01`.
Primary current-code and schema references: [src/durable-academic.js](../../src/durable-academic.js), [src/academic-results.js](../../src/academic-results.js), [src/platform/final-result-slip-reconciliation.js](../../src/platform/final-result-slip-reconciliation.js), [src/platform/result-blocking-083-preflight.js](../../src/platform/result-blocking-083-preflight.js).
The operation summary below is read/join/insert/update/delete counts extracted from current source SQL. Samples include source line and SQL prefix. Dynamic SQL, indirect calls, and feature-gated branches may not be fully captured.

## Observed application contract

- Result workflows join student, class, subject, year, and term context, and result-blocking preserves a scoped uniqueness rule across result type and mock label.
- Published result/report-card behavior is distributed across runtime services and migration guards; there is no single complete current TiDB definition for all legacy and canonical result stores.

## Table evidence matrix

| Table | Evidence class / disposition | SQL ops R/J/I/U/D | Runtime write columns | Runtime read projections | Historical type candidates (not canonical) | SQL samples | Source modules |
|---|---|---:|---|---|---|---|---|
| `examinations` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | id,exam_type AS examType | id:TEXT, school_id:TEXT, name:TEXT, exam_type:TEXT, academic_year_id:TEXT, term_id:TEXT, created_at:TEXT | READ src/single-school-overview.js:41 [SELECT id,exam_type AS examType FROM examinations WHERE school_id=?] | [src/academic-results.js](../../src/academic-results.js), [src/auth.js](../../src/auth.js), [src/durable-academic.js](../../src/durable-academic.js), [src/examinations.js](../../src/examinations.js), [src/ges-assessment-libraries.js](../../src/ges-assessment-libraries.js), [src/module-registry.js](../../src/module-registry.js), [src/parent-dashboard.js](../../src/parent-dashboard.js), [src/proprietor-sidebar-routes.js](../../src/proprietor-sidebar-routes.js), [src/reporting.js](../../src/reporting.js), [src/server.mjs](../../src/server.mjs), [src/sidebar-classification.js](../../src/sidebar-classification.js), [src/sidebar-registry.js](../../src/sidebar-registry.js), [src/sidebar-route-contract.js](../../src/sidebar-route-contract.js), [src/single-school-overview.js](../../src/single-school-overview.js) |
| `examination_marks` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | em.state,em.examination_id AS examinationId,em.student_id AS studentId,sp.class_id AS classId | id:TEXT, school_id:TEXT, examination_id:TEXT, student_id:TEXT, subject_id:TEXT, raw_marks:REAL, weight:REAL, weighted_marks:REAL, grade:TEXT, comment:TEXT, state:TEXT, version:INTEGER | READ src/single-school-overview.js:40 [SELECT em.state,em.examination_id AS examinationId,em.student_id AS studentId,sp.class_id AS classId FROM examination_marks em LEFT JOIN student_profiles sp ON] | [src/single-school-overview.js](../../src/single-school-overview.js) |
| `academic_result_blocks` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 6/0/1/4/0 | blocked_at, blocked_by, blocked_by_role, reason, status, unblocked_at, unblocked_by | *; id; school_id, academic_year, term, class_id, result_type, IFNULL(mock_examination, '') AS mock_examination_key, student_id, COUNT(*) AS duplicate_count | id:VARCHAR(64), school_id:VARCHAR(64), academic_year:VARCHAR(128), term:VARCHAR(128), class_id:VARCHAR(128), student_id:VARCHAR(64), scope:ENUM('STUDENT','CLASS'), status:ENUM('BLOCKED','UNBLOCKED'), reason:VARCHAR(500), blocked_by:VARCHAR(64), blocked_by_role:VARCHAR(64), blocked_at:DATETIME | READ src/durable-result-blocking.js:26 [SELECT * FROM academic_result_blocks WHERE school_id=? AND academic_year=? AND term=? AND class_id=? AND student_id=? AND result_type=? AND ((mock_examination I]<br>READ src/durable-result-blocking.js:26 [SELECT * FROM academic_result_blocks WHERE school_id=? AND academic_year=? AND term=? AND class_id=? AND (student_id='*' OR student_id IS NULL) AND result_type=]<br>INSERT src/durable-result-blocking.js:36 [INSERT INTO academic_result_blocks (id,school_id,academic_year,term,class_id,student_id,scope,status,reason,blocked_by,blocked_by_role,blocked_at,result_type,mo]<br>READ src/durable-result-blocking.js:39 [SELECT id FROM academic_result_blocks WHERE school_id=? AND academic_year=? AND term=? AND class_id=? AND result_type=? AND mock_examination IS NOT DISTINCT FRO]<br>READ src/durable-result-blocking.js:40 [SELECT id FROM academic_result_blocks WHERE school_id=? AND academic_year=? AND term=? AND class_id=? AND result_type=? AND mock_examination_key=? AND student_i] | [src/durable-result-blocking.js](../../src/durable-result-blocking.js), [src/platform/academic-result-blocking-075-schema.js](../../src/platform/academic-result-blocking-075-schema.js), [src/platform/result-blocking-083-preflight.js](../../src/platform/result-blocking-083-preflight.js) |
| `academic_result_records` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED / UNRESOLVED | 0/0/0/0/0 | No INSERT/UPDATE columns extracted | No literal projection extracted | id:VARCHAR(191), school_id:VARCHAR(191), student_id:VARCHAR(191), class_id:VARCHAR(191), academic_year_id:VARCHAR(191), term_id:VARCHAR(191), examination:VARCHAR(16), mock_label:VARCHAR(64), attendance_json:JSON, assessment_json:JSON, status:VARCHAR(16), version:INT | No query extracted | [src/durable-academic.js](../../src/durable-academic.js) |
| `academic_score_records` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED / UNRESOLVED | 0/0/0/0/0 | No INSERT/UPDATE columns extracted | No literal projection extracted | id:VARCHAR(191), school_id:VARCHAR(191), record_type:VARCHAR(16), mock_label:VARCHAR(64), academic_year_id:VARCHAR(191), term_id:VARCHAR(191), class_id:VARCHAR(191), student_id:VARCHAR(191), subject_id:VARCHAR(191), ca_score:DECIMAL(6,2), ca_max:DECIMAL(6,2), examination_score:DECIMAL(6,2) | No query extracted | [src/ai/tidb-readiness.js](../../src/ai/tidb-readiness.js), [src/durable-academic.js](../../src/durable-academic.js), [src/platform/academic-migration-guard.js](../../src/platform/academic-migration-guard.js) |
| `student_transcript_versions` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT / UNRESOLVED | 0/0/0/0/0 | No INSERT/UPDATE columns extracted | No literal projection extracted | id:TEXT, transcript_id:TEXT, version_number:INTEGER, academic_snapshot:TEXT, document_checksum:VARCHAR(128), verification_token_hash:VARCHAR(128), generated_by:TEXT, generated_at:TEXT, published_by:TEXT, published_at:TEXT, regeneration_reason:TEXT, status:TEXT | No query extracted | None statically linked |

## Per-object unresolved evidence

### examinations

- Historical key/index/FK candidates (not canonical): PK id; FK school_id → schools(id); FK academic_year_id → academic_years(id); FK term_id → terms(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/academic-results.js, src/auth.js, src/durable-academic.js, src/examinations.js, src/ges-assessment-libraries.js, src/module-registry.js, src/parent-dashboard.js, src/proprietor-sidebar-routes.js, src/reporting.js, src/server.mjs, src/sidebar-classification.js, src/sidebar-registry.js, src/sidebar-route-contract.js, src/single-school-overview.js

### examination_marks

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE UNIQUE(examination_id, student_id, subject_id); INDEX idx_exam_marks_student(school_id, student_id, examination_id); INDEX idx_exam_marks_state(school_id, state); FK school_id → schools(id); FK examination_id → examinations(id); FK student_id → student_profiles(id); FK subject_id → subjects(id); FK entered_by → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/single-school-overview.js

### academic_result_blocks

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE uq_academic_result_block_scope(school_id, academic_year, term, class_id, student_id); UNIQUE uq_academic_result_block_tidb_scope(school_id, academic_year, term, class_id, result_type, mock_examination_key, student_id); INDEX idx_academic_result_block_lookup(school_id, academic_year, term, class_id, status)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/durable-result-blocking.js, src/platform/academic-result-blocking-075-schema.js, src/platform/result-blocking-083-preflight.js

### academic_result_records

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE uq_academic_result_record_scope(scope_key_hash); INDEX idx_academic_result_record_context(school_id(64); FK fk_academic_result_record_school: school_id → schools(id); FK fk_academic_result_record_student: student_id → students(id); FK fk_academic_result_record_class: class_id → classes(id); FK fk_academic_result_record_year: academic_year_id → academic_years(id); FK fk_academic_result_record_term: term_id → terms(id); FK fk_academic_result_record_saved_by: saved_by → users(id); FK fk_academic_result_record_published_by: published_by → users(id)
- Missing: No complete current runtime operation or approved retirement record establishes whether this object is still used.
- Missing: Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.
- Insufficient because: Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.
- Required decision/evidence: A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.
- Affected source/workflow evidence: src/durable-academic.js

### academic_score_records

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE UNIQUE(school_id, record_type, mock_label, academic_year_id, term_id, class_id, student_id, subject_id); UNIQUE uq_academic_score_record_scope(scope_key_hash); INDEX idx_academic_scores_lookup(school_id(64); INDEX idx_academic_scores_subject_scope(school_id(64); INDEX idx_academic_scores_student_subject(school_id, student_id, subject_id); FK school_id → schools(id); FK academic_year_id → academic_years(id); FK term_id → terms(id); FK class_id → classes(id); FK student_id → student_profiles(id); FK subject_id → subjects(id); FK entered_by → users(id); FK fk_academic_score_records_school: school_id → schools(id); FK fk_academic_score_records_student: student_id → student_profiles(id); FK fk_academic_score_records_class: class_id → classes(id); FK fk_academic_score_records_year: academic_year_id → academic_years(id); FK fk_academic_score_records_term: term_id → terms(id); FK fk_academic_score_records_subject: subject_id → subjects(id); FK fk_academic_score_records_entered_by: entered_by → users(id)
- Missing: No complete current runtime operation or approved retirement record establishes whether this object is still used.
- Missing: Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.
- Insufficient because: Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.
- Required decision/evidence: A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.
- Affected source/workflow evidence: src/ai/tidb-readiness.js, src/durable-academic.js, src/platform/academic-migration-guard.js

### student_transcript_versions

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE UNIQUE(verification_token_hash); UNIQUE UNIQUE(transcript_id, version_number); INDEX idx_student_transcript_versions_token(verification_token_hash); FK transcript_id → student_transcripts(id); FK generated_by → users(id); FK published_by → users(id); FK revoked_by → users(id)
- Missing: No complete current runtime operation or approved retirement record establishes whether this object is still used.
- Missing: Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.
- Insufficient because: Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.
- Required decision/evidence: A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.
- Affected source/workflow evidence: No current source path found.

## Contract status and unresolved requirements

- legacy/current result sources coexist
- view/result reconciliation inputs need canonical selection
- generated uniqueness migration needs target-version validation
- Exact SQL types, lengths/precision, nullability, defaults, primary/unique/index constraints, FK actions, charset/collation, and target-version compatibility remain unresolved unless a specific field is established by runtime behavior. The manifest preserves operation-level evidence; this document does not infer a full definition from a historical CREATE TABLE.
- Decisions requiring business-owner approval: identifier lifecycle, uniqueness scope, retention/deactivation, authorization policy, and clean-install workflow choices listed above.

## Validation evidence

- Relevant automated tests are recorded in the phase report and repository test suite; those tests validate application behavior, not a live TiDB schema.
- No production database was queried and no DDL was executed.
