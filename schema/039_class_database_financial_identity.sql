-- 039_class_database_financial_identity.sql
-- OSAAH DAYLIGHT SCHOOL MANAGEMENT SYSTEM
--
-- Strengthens the existing canonical students table for Class Database,
-- Attendance, Results, and Fee Hub identity lookups.
-- Additive only: no duplicate students, admissions, or enrollments.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS gender VARCHAR(16) DEFAULT NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS parent_guardian_name TEXT DEFAULT NULL;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS registered_parent_phone VARCHAR(32) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_students_school_permanent_id
  ON students(school_id, permanent_student_id);

CREATE INDEX IF NOT EXISTS idx_students_school_name
  ON students(school_id, full_name);

CREATE INDEX IF NOT EXISTS idx_students_parent_phone
  ON students(school_id, registered_parent_phone);
