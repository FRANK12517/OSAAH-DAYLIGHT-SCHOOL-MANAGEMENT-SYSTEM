-- Enforce permanent student ID uniqueness across all admission categories and
-- schools. Keep this as a new migration so released migration checksums remain
-- stable for databases that have already applied schema 038.
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_permanent_student_id_global
  ON students (permanent_student_id);
