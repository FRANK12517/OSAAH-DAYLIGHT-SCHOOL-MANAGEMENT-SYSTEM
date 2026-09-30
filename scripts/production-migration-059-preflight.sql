-- MIGRATION 059 PRODUCTION PREFLIGHT
-- READ ONLY: SELECT and INFORMATION_SCHEMA only.
-- Run manually in the TiDB SQL Editor. Do not append migration statements.

-- 1. DATABASE_IDENTITY
SELECT
  'DATABASE_IDENTITY' AS result_set,
  DATABASE() AS actual_database,
  'osaahdaylightschool' AS expected_database,
  CASE WHEN DATABASE() = 'osaahdaylightschool' THEN 'PASS' ELSE 'FAIL' END AS status;

-- 2. COLUMN_EXISTENCE
SELECT
  'COLUMN_EXISTENCE' AS result_set,
  c.TABLE_NAME,
  c.COLUMN_NAME,
  c.DATA_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  'PRESENT' AS status
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME = 'student_enrollments'
  AND c.COLUMN_NAME IN ('school_id', 'term_id')
UNION ALL
SELECT
  'COLUMN_EXISTENCE' AS result_set,
  'student_enrollments' AS TABLE_NAME,
  expected.COLUMN_NAME,
  NULL AS DATA_TYPE,
  NULL AS IS_NULLABLE,
  NULL AS COLUMN_DEFAULT,
  'ABSENT' AS status
FROM (
  SELECT 'school_id' AS COLUMN_NAME
  UNION ALL SELECT 'term_id'
) expected
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = 'student_enrollments'
 AND c.COLUMN_NAME = expected.COLUMN_NAME
WHERE c.COLUMN_NAME IS NULL;

-- 3. ENROLLMENT_COUNT
SELECT
  'ENROLLMENT_COUNT' AS result_set,
  COUNT(*) AS total_student_enrollments
FROM student_enrollments;

-- 4. ORPHAN_ENROLLMENTS
SELECT
  'ORPHAN_ENROLLMENTS' AS result_set,
  COUNT(*) AS orphan_enrollment_rows
FROM student_enrollments e
LEFT JOIN students s ON s.id = e.student_id
WHERE s.id IS NULL;

-- 5. NULL_STUDENT_SCHOOL
SELECT
  'NULL_STUDENT_SCHOOL' AS result_set,
  COUNT(*) AS enrollment_rows_without_valid_student_school
FROM student_enrollments e
JOIN students s ON s.id = e.student_id
WHERE s.school_id IS NULL OR TRIM(CAST(s.school_id AS CHAR)) = '';

-- 6. SCHOOL_PROVENANCE_ANOMALIES
-- With students.id as the canonical key, more than one school assignment for a
-- single student_id is the ambiguity condition. Orphans are reported separately.
SELECT
  'SCHOOL_PROVENANCE_ANOMALIES' AS result_set,
  COUNT(*) AS student_ids_with_multiple_school_values
FROM (
  SELECT e.student_id
  FROM student_enrollments e
  JOIN students s ON s.id = e.student_id
  GROUP BY e.student_id
  HAVING COUNT(DISTINCT s.school_id) > 1
) anomalies;

-- 7. SCHOOL_DISTRIBUTION
SELECT
  'SCHOOL_DISTRIBUTION' AS result_set,
  s.school_id,
  COUNT(*) AS enrollment_rows
FROM student_enrollments e
JOIN students s ON s.id = e.student_id
GROUP BY s.school_id
ORDER BY s.school_id;

-- 8. TERM_PROVENANCE
-- Migration 059 intentionally performs no term backfill. These metadata-only
-- checks show whether the current table has a term column and whether the
-- strongest repository candidate exposes a canonical term_id.
SELECT
  'TERM_PROVENANCE' AS result_set,
  'MIGRATION_059_TERM_BACKFILL' AS check_name,
  'NONE' AS planned_operation,
  'PASS' AS status
UNION ALL
SELECT
  'TERM_PROVENANCE' AS result_set,
  'student_enrollments.term_id_currently_present' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'NO' ELSE 'YES' END AS observed_value,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'REVIEW' END AS status
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'student_enrollments'
  AND COLUMN_NAME = 'term_id'
UNION ALL
SELECT
  'TERM_PROVENANCE' AS result_set,
  'academic_score_records.term_id_metadata' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END AS observed_value,
  'INFO_ONLY' AS status
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'academic_score_records'
  AND COLUMN_NAME = 'term_id';

-- 9. INDEX_CONSTRAINT_PREFLIGHT
-- Check the proposed three-column index name, all current enrollment indexes,
-- and the canonical student_id -> students.id foreign-key relationship.
SELECT
  'INDEX_CONSTRAINT_PREFLIGHT' AS result_set,
  'proposed_index_name' AS check_name,
  'idx_student_enrollments_compat_scope' AS object_name,
  CASE WHEN COUNT(*) = 0 THEN 'AVAILABLE' ELSE 'ALREADY_PRESENT' END AS status
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'student_enrollments'
  AND INDEX_NAME = 'idx_student_enrollments_compat_scope'
UNION ALL
SELECT
  'INDEX_CONSTRAINT_PREFLIGHT' AS result_set,
  'proposed_index_columns' AS check_name,
  'student_id,academic_year_id,class_id' AS object_name,
  COALESCE(GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ','), 'ABSENT') AS status
FROM INFORMATION_SCHEMA.STATISTICS s
WHERE s.TABLE_SCHEMA = DATABASE()
  AND s.TABLE_NAME = 'student_enrollments'
  AND s.INDEX_NAME = 'idx_student_enrollments_compat_scope'
UNION ALL
SELECT
  'INDEX_CONSTRAINT_PREFLIGHT' AS result_set,
  'existing_enrollment_index' AS check_name,
  s.INDEX_NAME AS object_name,
  GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ',') AS status
FROM INFORMATION_SCHEMA.STATISTICS s
WHERE s.TABLE_SCHEMA = DATABASE()
  AND s.TABLE_NAME = 'student_enrollments'
GROUP BY s.INDEX_NAME
UNION ALL
SELECT
  'INDEX_CONSTRAINT_PREFLIGHT' AS result_set,
  'student_id_foreign_key' AS check_name,
  COALESCE(k.CONSTRAINT_NAME, 'NONE_FOUND') AS object_name,
  CASE WHEN k.CONSTRAINT_NAME IS NULL THEN 'REVIEW' ELSE 'PRESENT' END AS status
FROM (SELECT 1 AS one) seed
LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
  ON k.TABLE_SCHEMA = DATABASE()
 AND k.TABLE_NAME = 'student_enrollments'
 AND k.COLUMN_NAME = 'student_id'
 AND k.REFERENCED_TABLE_SCHEMA = DATABASE()
 AND k.REFERENCED_TABLE_NAME = 'students'
 AND k.REFERENCED_COLUMN_NAME = 'id';

-- 10. TABLE_ENGINE_SCHEMA_COMPATIBILITY
SELECT
  'TABLE_ENGINE_SCHEMA_COMPATIBILITY' AS result_set,
  t.TABLE_NAME,
  t.ENGINE,
  t.TABLE_COLLATION,
  t.TABLE_TYPE,
  c.COLUMN_NAME,
  c.DATA_TYPE,
  c.CHARACTER_MAXIMUM_LENGTH,
  c.IS_NULLABLE,
  CASE
    WHEN t.ENGINE IS NULL THEN 'TABLE_NOT_FOUND'
    WHEN t.ENGINE NOT IN ('InnoDB','TiDB') THEN 'REVIEW_ENGINE'
    ELSE 'PRESENT'
  END AS status
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
  ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
 AND c.TABLE_NAME = t.TABLE_NAME
 AND c.COLUMN_NAME IN ('id', 'student_id', 'academic_year_id', 'class_id', 'school_id', 'term_id')
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN ('students', 'student_enrollments')
ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION;

-- 11. SCHOOL_COLUMN_TYPE_COMPATIBILITY
-- The proposed school_id is VARCHAR(191) NULL. Compare it with the canonical
-- students.school_id metadata without reading student rows.
SELECT
  'SCHOOL_COLUMN_TYPE_COMPATIBILITY' AS result_set,
  c.TABLE_NAME,
  c.COLUMN_NAME,
  c.DATA_TYPE,
  c.CHARACTER_MAXIMUM_LENGTH,
  c.IS_NULLABLE,
  CASE
    WHEN c.COLUMN_NAME IS NULL THEN 'MISSING_CANONICAL_COLUMN'
    WHEN c.DATA_TYPE IN ('varchar','char','text') THEN 'REVIEW_LENGTH_AND_COLLATION'
    ELSE 'REVIEW_TYPE'
  END AS status
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME = 'students'
  AND c.COLUMN_NAME = 'school_id';
