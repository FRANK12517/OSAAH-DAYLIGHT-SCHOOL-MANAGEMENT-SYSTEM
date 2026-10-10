-- Restore the enrollment-current flag already defined by migrations 038 and 054.
-- The exact column default keeps legacy reads compatible and preserves existing
-- enrollment rows without fabricating or rewriting enrollment history.
ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS is_current TINYINT(1) NOT NULL DEFAULT 1;
