# Attendance and Assessments database contract

> Status: **PARTIAL**. This is an evidence reconstruction, not approved canonical TiDB DDL. Historical types/constraints are candidate evidence only.

## Scope and runtime evidence

Target database: `osaahdaylightschool`; school scope: `sch_default_01`.
Primary current-code and schema references: [src/attendance-repository.js](../../src/attendance-repository.js), [src/student-attendance-overview.js](../../src/student-attendance-overview.js), [src/staff-attendance-overview.js](../../src/staff-attendance-overview.js), [src/durable-academic.js](../../src/durable-academic.js), [src/academic-results.js](../../src/academic-results.js).
The operation summary below is read/join/insert/update/delete counts extracted from current source SQL. Samples include source line and SQL prefix. Dynamic SQL, indirect calls, and feature-gated branches may not be fully captured.

## Observed application contract

- Attendance writes carry status, method, timestamps, version, and updater/entry identity where the writer supports them. Application services preserve present/absent/tardy/excused distinctions and school/class/year scope.
- Assessment storage is split across examination, marks, and newer academic score/result stores. Numeric precision and uniqueness across these stores are not fully reconciled.

## Table evidence matrix

| Table | Evidence class / disposition | SQL ops R/J/I/U/D | Runtime write columns | Runtime read projections | Historical type candidates (not canonical) | SQL samples | Source modules |
|---|---|---:|---|---|---|---|---|
| `student_attendance` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 4/0/1/1/0 | arrival_time, departure_time, method, reason, source, status, updated_at, updated_by, version | ${STUDENT_SELECT}; student_id AS studentId,status,attendance_date AS date | id:TEXT, school_id:TEXT, attendance_date:VARCHAR(50), class_id:TEXT, student_id:TEXT, subject_id:VARCHAR(191), status:TEXT, method:VARCHAR(32), arrival_time:VARCHAR(50), departure_time:VARCHAR(50), reason:TEXT, version:INT | READ src/attendance-repository.js:40 [SELECT ${STUDENT_SELECT} FROM student_attendance WHERE school_id=? AND academic_year=? AND term=? AND attendance_date=? AND class_id=? AND student_id=? AND subj]<br>UPDATE src/attendance-repository.js:50 [UPDATE student_attendance SET status=?,method=?,arrival_time=?,departure_time=?,reason=?,version=version+1,updated_by=?,updated_at=?,source=? WHERE id=? AND sch]<br>INSERT src/attendance-repository.js:53 [INSERT INTO student_attendance (id,school_id,academic_year,term,attendance_date,class_id,student_id,subject_id,subject_key,status,method,arrival_time,departure_]<br>READ src/attendance-repository.js:59 [SELECT ${STUDENT_SELECT} FROM student_attendance WHERE id=? AND school_id=?]<br>READ src/attendance-repository.js:127 [SELECT ${STUDENT_SELECT} FROM student_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,student_id] | [src/ai/tidb-readiness.js](../../src/ai/tidb-readiness.js), [src/attendance-repository.js](../../src/attendance-repository.js), [src/single-school-overview.js](../../src/single-school-overview.js), [src/student-attendance-overview.js](../../src/student-attendance-overview.js) |
| `staff_attendance` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 4/0/1/1/0 | academic_year, attendance_date, attendance_source, attendance_status, attendance_time, attendance_type, leave_request_id, note, previous_status, source, term, updated_at, updated_by | ${STAFF_SELECT}; staff_id AS staffId,attendance_type AS type,attendance_date AS date | id:TEXT, school_id:TEXT, staff_id:TEXT, attendance_date:TEXT, attendance_type:TEXT, attendance_time:TEXT, entered_by:TEXT, created_at:TEXT, academic_year:VARCHAR(64), term:VARCHAR(32), attendance_status:VARCHAR(32), attendance_source:VARCHAR(32) | READ src/attendance-repository.js:80 [SELECT ${STAFF_SELECT} FROM staff_attendance WHERE id=? AND school_id=? LIMIT 1 FOR UPDATE]<br>UPDATE src/attendance-repository.js:98 [UPDATE staff_attendance SET academic_year=?,term=?,attendance_date=?,attendance_type=?,attendance_status=?,attendance_source=?,leave_request_id=?,note=?,previou]<br>INSERT src/attendance-repository.js:101 [INSERT INTO staff_attendance (id,school_id,academic_year,term,staff_id,attendance_date,attendance_type,attendance_status,attendance_source,leave_request_id,note]<br>READ src/attendance-repository.js:108 [SELECT ${STAFF_SELECT} FROM staff_attendance WHERE id=? AND school_id=?]<br>READ src/attendance-repository.js:134 [SELECT ${STAFF_SELECT} FROM staff_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,staff_id] | [src/attendance-repository.js](../../src/attendance-repository.js), [src/single-school-overview.js](../../src/single-school-overview.js), [src/staff-attendance-overview.js](../../src/staff-attendance-overview.js) |
| `examinations` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | id,exam_type AS examType | id:TEXT, school_id:TEXT, name:TEXT, exam_type:TEXT, academic_year_id:TEXT, term_id:TEXT, created_at:TEXT | READ src/single-school-overview.js:41 [SELECT id,exam_type AS examType FROM examinations WHERE school_id=?] | [src/academic-results.js](../../src/academic-results.js), [src/auth.js](../../src/auth.js), [src/durable-academic.js](../../src/durable-academic.js), [src/examinations.js](../../src/examinations.js), [src/ges-assessment-libraries.js](../../src/ges-assessment-libraries.js), [src/module-registry.js](../../src/module-registry.js), [src/parent-dashboard.js](../../src/parent-dashboard.js), [src/proprietor-sidebar-routes.js](../../src/proprietor-sidebar-routes.js), [src/reporting.js](../../src/reporting.js), [src/server.mjs](../../src/server.mjs), [src/sidebar-classification.js](../../src/sidebar-classification.js), [src/sidebar-registry.js](../../src/sidebar-registry.js), [src/sidebar-route-contract.js](../../src/sidebar-route-contract.js), [src/single-school-overview.js](../../src/single-school-overview.js) |
| `examination_marks` | RUNTIME_SQL_CONFIRMED / REQUIRED_CURRENT_RUNTIME | 1/0/0/0/0 | No INSERT/UPDATE columns extracted | em.state,em.examination_id AS examinationId,em.student_id AS studentId,sp.class_id AS classId | id:TEXT, school_id:TEXT, examination_id:TEXT, student_id:TEXT, subject_id:TEXT, raw_marks:REAL, weight:REAL, weighted_marks:REAL, grade:TEXT, comment:TEXT, state:TEXT, version:INTEGER | READ src/single-school-overview.js:40 [SELECT em.state,em.examination_id AS examinationId,em.student_id AS studentId,sp.class_id AS classId FROM examination_marks em LEFT JOIN student_profiles sp ON] | [src/single-school-overview.js](../../src/single-school-overview.js) |
| `academic_score_records` | RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED / UNRESOLVED | 0/0/0/0/0 | No INSERT/UPDATE columns extracted | No literal projection extracted | id:VARCHAR(191), school_id:VARCHAR(191), record_type:VARCHAR(16), mock_label:VARCHAR(64), academic_year_id:VARCHAR(191), term_id:VARCHAR(191), class_id:VARCHAR(191), student_id:VARCHAR(191), subject_id:VARCHAR(191), ca_score:DECIMAL(6,2), ca_max:DECIMAL(6,2), examination_score:DECIMAL(6,2) | No query extracted | [src/ai/tidb-readiness.js](../../src/ai/tidb-readiness.js), [src/durable-academic.js](../../src/durable-academic.js), [src/platform/academic-migration-guard.js](../../src/platform/academic-migration-guard.js) |
| `grading_systems` | HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT / UNRESOLVED | 0/0/0/0/0 | No INSERT/UPDATE columns extracted | No literal projection extracted | id:TEXT, school_id:TEXT, name:TEXT, boundaries_json:TEXT, created_at:TEXT, updated_at:TEXT | No query extracted | None statically linked |

## Per-object unresolved evidence

### student_attendance

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE UNIQUE(school_id, attendance_date, student_id, subject_id); UNIQUE uq_student_attendance_scope_identity(school_id, academic_year, term, attendance_date, class_id, student_id, subject_key); UNIQUE uq_student_attendance_scope_identity(school_id, academic_year, term, date, class_id, student_id, subject_key); INDEX idx_student_attendance_class_date(school_id, class_id, attendance_date); INDEX idx_student_attendance_student_date(student_id, attendance_date); INDEX idx_student_attendance_scope(school_id, academic_year, term, class_id, date); INDEX idx_student_attendance_canonical_read(school_id, academic_year, term, class_id, attendance_date, student_id); FK school_id → schools(id); FK class_id → classes(id); FK student_id → student_profiles(id); FK subject_id → subjects(id); FK entered_by → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/ai/tidb-readiness.js, src/attendance-repository.js, src/single-school-overview.js, src/student-attendance-overview.js

### staff_attendance

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE uq_staff_attendance_scope_identity(school_id, academic_year, term, attendance_date, staff_id, attendance_type); INDEX idx_staff_attendance_scope(school_id, academic_year, term, attendance_date, staff_id); INDEX idx_staff_attendance_staff_date(school_id, academic_year, term, staff_id, attendance_date); INDEX idx_staff_attendance_leave_link(school_id, leave_request_id, attendance_date); FK school_id → schools(id); FK staff_id → staff(id); FK entered_by → users(id)
- Missing: The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.
- Missing: Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.
- Insufficient because: Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.
- Required decision/evidence: A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.
- Affected source/workflow evidence: src/attendance-repository.js, src/single-school-overview.js, src/staff-attendance-overview.js

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

### academic_score_records

- Historical key/index/FK candidates (not canonical): PK id; UNIQUE UNIQUE(school_id, record_type, mock_label, academic_year_id, term_id, class_id, student_id, subject_id); UNIQUE uq_academic_score_record_scope(scope_key_hash); INDEX idx_academic_scores_lookup(school_id(64); INDEX idx_academic_scores_subject_scope(school_id(64); INDEX idx_academic_scores_student_subject(school_id, student_id, subject_id); FK school_id → schools(id); FK academic_year_id → academic_years(id); FK term_id → terms(id); FK class_id → classes(id); FK student_id → student_profiles(id); FK subject_id → subjects(id); FK entered_by → users(id); FK fk_academic_score_records_school: school_id → schools(id); FK fk_academic_score_records_student: student_id → student_profiles(id); FK fk_academic_score_records_class: class_id → classes(id); FK fk_academic_score_records_year: academic_year_id → academic_years(id); FK fk_academic_score_records_term: term_id → terms(id); FK fk_academic_score_records_subject: subject_id → subjects(id); FK fk_academic_score_records_entered_by: entered_by → users(id)
- Missing: No complete current runtime operation or approved retirement record establishes whether this object is still used.
- Missing: Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.
- Insufficient because: Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.
- Required decision/evidence: A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.
- Affected source/workflow evidence: src/ai/tidb-readiness.js, src/durable-academic.js, src/platform/academic-migration-guard.js

### grading_systems

- Historical key/index/FK candidates (not canonical): PK id; FK school_id → schools(id)
- Missing: No complete current runtime operation or approved retirement record establishes whether this object is still used.
- Missing: Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.
- Insufficient because: Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.
- Required decision/evidence: A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.
- Affected source/workflow evidence: No current source path found.

## Contract status and unresolved requirements

- assessment/result stores have parallel historical shapes
- score precision, uniqueness, version, and FK contracts require field-level reconciliation
- Exact SQL types, lengths/precision, nullability, defaults, primary/unique/index constraints, FK actions, charset/collation, and target-version compatibility remain unresolved unless a specific field is established by runtime behavior. The manifest preserves operation-level evidence; this document does not infer a full definition from a historical CREATE TABLE.
- Decisions requiring business-owner approval: identifier lifecycle, uniqueness scope, retention/deactivation, authorization policy, and clean-install workflow choices listed above.

## Validation evidence

- Relevant automated tests are recorded in the phase report and repository test suite; those tests validate application behavior, not a live TiDB schema.
- No production database was queried and no DDL was executed.
