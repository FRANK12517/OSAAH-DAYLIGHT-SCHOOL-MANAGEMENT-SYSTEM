-- 059_backward_compatible_enrollment_contract.sql
-- Additive local prototype for production installations missing the newer
-- enrollment scope columns. This migration is intentionally non-destructive:
-- school_id is backfilled only from the canonical students row; term_id is
-- never fabricated and remains NULL when authoritative provenance is absent.

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS school_id VARCHAR(191) NULL;

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS term_id VARCHAR(64) NULL;

UPDATE student_enrollments e
JOIN students s ON s.id = e.student_id
SET e.school_id = s.school_id
WHERE e.school_id IS NULL
  AND s.school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_compat_scope
  ON student_enrollments (school_id, student_id, academic_year_id, class_id, term_id);

-- No term backfill is performed. Rows with missing or conflicting provenance
-- remain NULL and are handled by record-specific Parent authorization.
