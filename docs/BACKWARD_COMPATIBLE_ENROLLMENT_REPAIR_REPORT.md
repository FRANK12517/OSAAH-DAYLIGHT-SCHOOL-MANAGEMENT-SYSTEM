# BACKWARD-COMPATIBLE ENROLLMENT REPAIR REPORT

## Canonical Model

### `school_id`

**Nullable during compatibility migration; required for every new canonical enrollment write.**

Canonical relationship:

```text
student_enrollments.student_id
  -> students.id
  -> students.school_id
```

This relationship is deterministic because `student_enrollments.student_id` references the canonical `students.id`, and `students.school_id` is the tenant boundary used throughout the repository. The local migration adds `student_enrollments.school_id` as nullable, then backfills only rows that resolve through `students.id` to a non-null `students.school_id`.

The local prototype does not make the column `NOT NULL`. Before that hardening step, production must verify that every enrollment resolves to exactly one canonical student and school, that no orphaned enrollment remains, and that no conflicting school assignment exists. No student rows are fabricated and no ambiguous row is guessed.

### `term_id`

**Nullable compatibility field.**

- New term-aware workflows persist the actual selected/canonical `term_id`.
- Legacy rows may remain `NULL` when authoritative historical provenance is unavailable.
- No default term is introduced.
- No term is inferred from current term, date, class, fee payment, or a display label.
- `term_id` can become `NOT NULL` only after a future, separately verified invariant proves that every remaining enrollment is a genuinely term-scoped record and that unresolved annual/year-class records have been explicitly migrated to a different contract. That condition is not currently met.

### Legacy term behavior

A legacy enrollment with `term_id IS NULL` authorizes only the same authenticated parent, school, canonical student, academic year, and class. It does **not** authorize every term.

- Student Summary may use the year/class enrollment because its academic context is descriptive and its term is not used to authorize a term-specific record.
- Attendance, Published Results, Fees, Payments/Receipts, and Timetable require the requested record type’s own durable/configured evidence for the selected term before a legacy enrollment is accepted.
- Missing, multiple, or conflicting evidence denies the term-scoped request; the system does not choose a term.

### New enrollment behavior

Admissions already receives school, academic year, class, and optional term context. The write path now remains explicitly term-compatible:

```sql
INSERT INTO student_enrollments
  (id, student_id, school_id, class_id, academic_year_id, term_id,
   enrollment_status, is_current, enrolled_at)
VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?)
```

`school_id` comes from the accepted application’s authenticated school context. `term_id` comes from the accepted application/applicant’s canonical `term_id`/term value and remains nullable if the workflow is legitimately annual or historical term provenance is absent.

## Compatibility Across Application Areas

| Area | Compatibility result |
|---|---|
| Admissions acceptance | Compatible. New accepted admissions persist school and the selected term when present; no fake term is required. |
| Class Database | Compatible. Existing year/class historical projection remains year/class scoped; nullable term does not remove class history. |
| Promotion | Compatible. Promotion remains a separate academic decision/history workflow; no historical enrollment term is fabricated. |
| Parent authorization | Compatible after the local change: explicit terms match exactly; NULL-term legacy rows require record-specific evidence for term-scoped records. |
| Score Entry | Compatible. Current score-entry roster remains term-scoped where it has explicit enrollment/result context. Legacy rows without term are not silently assigned one. |
| Result Slip | Compatible. Published result loading remains selected year/term/class scoped; legacy NULL-term authorization requires published student-specific result evidence. |
| Attendance | Compatible. Attendance remains independently filtered by its durable academic-year/term/class source; legacy enrollment alone cannot authorize arbitrary terms. |
| Finance | Compatible. Fee and receipt sources remain independently year/term/class scoped; financial evidence is used only for the corresponding record request, never as a universal enrollment backfill. |
| Reporting | Compatible. Reports retain school/year/class/term filters and sample isolation; NULL-term historical rows are not assigned to an invented cohort. |
| Completed/graduated records | Unchanged. Parent completed-record access remains unsupported; class archive/history does not require term fabrication. |

## School-ID Reconciliation

The relationship is accepted as canonical and deterministic:

```text
student_enrollments.student_id -> students.id -> students.school_id
```

The local migration performs:

```sql
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS school_id VARCHAR(191) NULL;

UPDATE student_enrollments e
JOIN students s ON s.id = e.student_id
SET e.school_id = s.school_id
WHERE e.school_id IS NULL
  AND s.school_id IS NOT NULL;
```

A future hardening preflight must report, without exposing PII:

- enrollment rows with no matching `students.id`;
- rows whose canonical student has a NULL school;
- rows whose existing enrollment school differs from `students.school_id`; and
- duplicate/conflicting canonical student-school mappings.

Until those counts are zero, `school_id` remains nullable.

## Parent Authorization

All authorization remains server-side and retains the existing active-link, school, permanent-ID, and test-record checks.

### Explicit-term enrollment

The server requires:

1. active Parent account in the requested school;
2. active `parent_student_links` relationship;
3. canonical `students.permanent_student_id` match;
4. canonical student school match;
5. `COALESCE(students.is_test_record,0)=0` for official authorization;
6. `student_enrollments.academic_year_id` match;
7. `student_enrollments.class_id` match; and
8. when `enrollment.term_id IS NOT NULL`, exact requested `term_id` match.

### Legacy NULL-term enrollment

A NULL-term row first passes the same parent/student/school/year/class checks. It then follows the record-specific rule:

- `student-summary`: allowed at the same year/class scope;
- `attendance`: a selected-child attendance record must exist for the requested school, year, term, and class;
- `published-results`: the result publication must be `PUBLISHED` and the selected child’s result must load for the requested year/term/class;
- `fees`: a selected-child published obligation must exist for the requested year/term/class;
- `payments` / `payment-receipts`: a selected-child durable receipt/payment must match the requested year/term and class where present;
- `timetable`: a configured timetable must exist for the requested year/term/class.

No evidence means denial. Multiple or conflicting provenance is not collapsed into an authorization decision.

### Record-specific term validation

`Parent Dashboard.validateContext()` still validates that the requested term exists and belongs to the requested academic year before record loading. The compatibility callback is invoked only after that validation and receives the selected canonical year, term, and class.

## Record-Type Matrix

| Parent record type | Durable/configured source | Academic-year scoped? | Term scoped? | Safe legacy authorization rule |
|---|---|---:|---:|---|
| Student Summary | canonical student + `student_enrollments` | Yes | Context only; summary itself is not term-data dependent | Same parent, school, student, year, and class; NULL enrollment term is allowed. |
| Attendance | `attendanceRepository.listStudentRecords` / `student_attendance` | Yes | Yes; stored academic-year/term values plus class | Require a selected-child attendance row for the requested year, term, and class. |
| Published Results | `academicResults.publicationFor` + `academicResults.result` / canonical score-result path | Yes | Yes | Require `PUBLISHED` publication and successful selected-child result load for the exact context. |
| Fees | `parentFeeObligations.listForParent` / fee obligations | Yes | Yes when obligation has term scope | Require selected-child published obligation for exact year/term/class; do not use fee evidence as universal enrollment provenance. |
| Payments | `durableFeeReader` / durable payment and receipt sources | Yes | Yes | Require selected-child durable payment/receipt matching requested year/term and class where present. |
| Payment Receipts | `durableFeeReader.listReceipts` + receipt branding | Yes | Yes | Same as Payments; no receipt means no legacy term authorization. |
| Timetable | `examinations.listTimetables` | Yes | Yes | Require a configured timetable for requested year/term/class; student identity remains enforced by the enrollment relationship. |
| Homework | None; explicitly unsupported | N/A | N/A | Not available; no authorization path invented. |
| Assignments | None; explicitly unsupported | N/A | N/A | Not available; no authorization path invented. |
| Documents | None; explicitly unsupported | N/A | N/A | Not available; no authorization path invented. |
| Promotion History | Explicitly unsupported in Parent Dashboard | N/A | N/A | Not available; no authorization path invented. |
| Completed / Graduated Records | Explicitly unsupported in Parent Dashboard | N/A | N/A | Not available; no authorization path invented. |

## Migration

### Proposed migration

`schema/059_backward_compatible_enrollment_contract.sql`

### `school_id` DDL

```sql
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS school_id VARCHAR(191) NULL;
```

### `school_id` backfill

```sql
UPDATE student_enrollments e
JOIN students s ON s.id = e.student_id
SET e.school_id = s.school_id
WHERE e.school_id IS NULL
  AND s.school_id IS NOT NULL;
```

This is deterministic and non-destructive. It preserves enrollment IDs, relationships, and existing values.

### `term_id` DDL

```sql
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS term_id VARCHAR(191) NULL;
```

### Term backfill

**NONE.**

The migration intentionally does not backfill terms from scores, fees, attendance, dates, current term, or any ambiguous source. Selective provenance is retained as a future read-only analysis option, but this prototype leaves historical `term_id` NULL unless it was already present.

The migration also does not add `classes.display_order`, `classes.level_id`, or `classes.sort_order`.

### Migration safety

- TiDB/MySQL-compatible additive DDL.
- No table recreation.
- No deletion or destructive alteration.
- No fabricated term.
- No class-schema changes.
- Test/sample isolation remains enforced by existing `is_test_record` predicates.

### Production applied

**NO**

## Implementation

### Branch

`repair/backward-compatible-enrollment-contract`

### Files changed

- `src/admission-enrollment.js`
  - explicit-term matching now permits a NULL-term compatibility row;
  - legacy NULL-term records require a record-specific evidence callback except Student Summary;
  - existing parent, school, active-link, canonical student, and test-record predicates remain unchanged.
- `src/parent-dashboard.js`
  - passes the requested record type and canonical term context into enrollment authorization;
  - adds server-side evidence checks for Attendance, Published Results, Fees, Payments/Receipts, and Timetable.
- `schema/059_backward_compatible_enrollment_contract.sql`
  - new unexecuted additive compatibility migration.
- `test/backward-compatible-enrollment.test.js`
  - new explicit-term, legacy NULL-term, evidence-required, and strict-scope tests.
- `test/admission-enrollment.test.js`
  - updated local fixture expectations for the class-before-term parameter order.
- `test/part2-schema-upgrade.test.js`
  - updated migration inventory expectation.
- `test/ai-production-acceptance.test.js`
  - updated repository migration acceptance expectation.
- `docs/BACKWARD_COMPATIBLE_ENROLLMENT_REPAIR_REPORT.md`
  - this report.

`npm install --ignore-scripts` created/updated local dependency installation metadata only as needed for test execution; it was not deployed or used to access production.

## Tests

### Focused

**PASS — 32 tests passed, 0 failed.**

Command:

```bash
node --test test/backward-compatible-enrollment.test.js \
  test/parent-dashboard.test.js \
  test/admission-enrollment.test.js \
  test/part2-schema-upgrade.test.js
```

The focused tests cover explicit-term authorization, legacy NULL-term Student Summary behavior, denial of arbitrary legacy terms, record-specific evidence, active Parent links, school/year/class binding, and migration discovery.

### Full suite

**PASS — 898 tests passed, 0 failed.**

Command:

```bash
npm test
```

### Baseline

`894` tests passed before this repair phase.

The resulting total is 898 because four new compatibility tests were added; no pre-existing test failed.

## Security

| Invariant | Result |
|---|---|
| Cross-child authorization | **PASS** — Parent identity and active `parent_student_links` remain server-side requirements. |
| Cross-school | **PASS** — Parent/user/student/enrollment school joins remain scoped; new `school_id` is derived from canonical student identity. |
| Cross-year | **PASS** — enrollment academic year and configured requested year must match. |
| Cross-class | **PASS** — enrollment class and configured requested class must match. |
| Legacy cross-term | **PASS** — NULL-term enrollment does not authorize arbitrary term data; record-specific durable/configured evidence is required. |
| Sample isolation | **PASS** — `COALESCE(s.is_test_record,0)=0` remains in official enrollment authorization, and existing sample-parent controls remain unchanged. |
| Server-side authorization | **PASS** — compatibility behavior is implemented in the service layer, not delegated to client parameters. |

## Production

Schema changes: **NONE**

Data changes: **NONE**

Deployment: **NONE**

Main merge: **NONE**

No production database was contacted, altered, migrated, or updated. No production credentials, connection strings, student rows, or PII were accessed.

## Decision

### READY FOR PRODUCTION MIGRATION REVIEW: **NO**

The local contract and tests are ready for a controlled review, but production migration review is not yet authorized as an execution step. Before any production migration review can proceed, the owner must separately approve:

1. a read-only preflight proving every enrollment can be classified as canonical, orphaned, NULL-school, or conflicting-school;
2. the exact production schema snapshot for `student_enrollments` and `students`;
3. the migration allowlist containing only version 059;
4. post-migration schema and row-count verification; and
5. an operational rollback/stop plan that does not fabricate terms.

The implementation is **local-only**, the migration is **not applied**, and deployment/merge are **none**.

**STOP.**
