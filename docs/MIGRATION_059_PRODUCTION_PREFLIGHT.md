# MIGRATION 059 PRODUCTION PREFLIGHT

## Migration Audit

Migration file:

`schema/059_backward_compatible_enrollment_contract.sql`

### Exact proposed operations

1. Add nullable `student_enrollments.school_id VARCHAR(191)` if it does not already exist.
2. Add nullable `student_enrollments.term_id VARCHAR(64)` if it does not already exist.
3. Backfill only missing enrollment school values through the canonical relationship:

   ```sql
   UPDATE student_enrollments e
   JOIN students s ON s.id = e.student_id
   SET e.school_id = s.school_id
   WHERE e.school_id IS NULL
     AND s.school_id IS NOT NULL;
   ```

4. Add the compatibility index:

   ```sql
   CREATE INDEX IF NOT EXISTS idx_student_enrollments_compat_scope
     ON student_enrollments (school_id, student_id, academic_year_id, class_id, term_id);
   ```

5. Perform no term backfill.

### Safety findings

| Requirement | Finding |
|---|---|
| `school_id` introduced safely | **PASS.** Additive nullable `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. |
| `term_id` nullable | **PASS.** Declared `VARCHAR(64) NULL`; no `NOT NULL` or default. |
| No historical term fabricated | **PASS.** Migration contains no term `UPDATE`, `INSERT`, default, date inference, or source-derived term assignment. |
| Canonical school relationship | **PASS.** Backfill joins only `student_enrollments.student_id = students.id` and copies `students.school_id`. |
| Existing school values protected | **PASS.** `WHERE e.school_id IS NULL` prevents overwriting non-null values. Existing conflicting values are not silently corrected; they must be reported by preflight. |
| Enrollment rows deleted | **PASS.** No `DELETE`, `TRUNCATE`, `DROP`, or table recreation. |
| Student records modified | **PASS.** Only `student_enrollments` is altered/updated; `students` is read by the join. |
| Class schema modified | **PASS.** No `classes` operation appears in migration 059. |
| TiDB/MySQL compatibility | **PASS WITH PREFLIGHT.** The repository already uses `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` in the TiDB/MySQL migration contract. Engine, column types, existing indexes, and foreign keys must still be checked by the supplied metadata script. |
| Repeated execution | **PASS.** `IF NOT EXISTS` makes column/index DDL repeat-safe. The backfill is repeat-safe because it updates only NULL `school_id` values and does not overwrite populated values. |
| Partial execution | **PASS WITH REVIEW.** If execution stops after either column addition or before the index, rerunning the same migration does not recreate existing objects. If the backfill partially completes, rerunning fills only remaining NULL values with non-null canonical student schools. Any pre-existing conflicting non-null school values remain untouched and must cause a separate preflight NO-GO. |

### Important boundary

The migration is structurally safe only if the production preflight confirms that every enrollment row used by the backfill resolves to a canonical student with a valid, deterministic school. The migration itself intentionally does not delete or repair orphaned or conflicting rows.

## GO Requirements

The manual preflight must produce all of the following:

1. `DATABASE()` equals exactly `osaahdaylightschool`.
2. `student_enrollments.school_id` is absent before migration.
3. `student_enrollments.term_id` is absent before migration.
4. Every enrollment row resolves to exactly one canonical `students.id`.
5. Orphan enrollment count is exactly `0`.
6. Every canonical student used by an enrollment has a non-null, non-empty `students.school_id`.
7. Invalid/null student-school enrollment count is exactly `0`.
8. School provenance ambiguity count is exactly `0`.
9. Existing school distribution is explainable and contains no unexpected NULL/empty bucket.
10. No conflicting existing index name, index definition, foreign key, or incompatible column type is reported for the proposed additions.
11. Relevant tables use a compatible TiDB/MySQL engine and are present.
12. Migration 059 matches the tested local implementation and has not been edited after local validation.
13. Term backfill operation is exactly `NONE`; historical `term_id` values may remain NULL.

**NO-GO** if any criterion fails, if the database identity is wrong, if either expected-absent column is already present with an incompatible definition, if any orphan/NULL-school/ambiguous-school anomaly exists, or if an index/constraint/type conflict is reported.

Even if every criterion passes, the preflight result is not approval to execute migration 059. It is evidence for a separate manual review.

## Copy-Ready Read-Only SQL

The complete SELECT/INFORMATION_SCHEMA-only script is provided as a separate artifact:

[Production Migration 059 Preflight SQL](</home/ubuntu/work/osaa-daylight/scripts/production-migration-059-preflight.sql>)

It produces labeled result sets for:

- `DATABASE_IDENTITY`
- `COLUMN_EXISTENCE`
- `ENROLLMENT_COUNT`
- `ORPHAN_ENROLLMENTS`
- `NULL_STUDENT_SCHOOL`
- `SCHOOL_PROVENANCE_ANOMALIES`
- `SCHOOL_DISTRIBUTION`
- `TERM_PROVENANCE`
- `INDEX_CONSTRAINT_PREFLIGHT`
- `TABLE_ENGINE_SCHEMA_COMPATIBILITY`
- `SCHOOL_COLUMN_TYPE_COMPATIBILITY`

The script returns aggregate counts and schema metadata only. It does not select student names, enrollment rows, addresses, phone numbers, credentials, or other student PII.

The script contains no `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `TRUNCATE`, or `REPLACE` statement.

## Execution Status

Production database queried: **NO**

Production schema changes: **NONE**

Production data changes: **NONE**

Migration 059 applied: **NO**

Deployment: **NONE**

Merge to main: **NONE**

Credentials or `DATABASE_URL` exposed: **NO**

## Decision

**NO-GO FOR PRODUCTION EXECUTION.**

The local migration audit passes structurally, and the read-only preflight SQL is ready for manual execution. Production approval remains blocked until the user runs the script in the intended TiDB SQL Editor and provides the aggregate/schema result sets for review.
