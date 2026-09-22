-- Part 1: durable attendance academic scope.
-- Existing rows are retained and receive the explicit legacy scope marker.
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS term VARCHAR(32) NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS subject_key VARCHAR(128) NOT NULL DEFAULT 'daily';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NOT NULL DEFAULT 'UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS term VARCHAR(32) NOT NULL DEFAULT 'UNSPECIFIED';

CREATE INDEX IF NOT EXISTS idx_student_attendance_scope ON student_attendance(school_id, academic_year, term, class_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_scope ON staff_attendance(school_id, academic_year, term, attendance_date, staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_attendance_scope_identity ON student_attendance(school_id, academic_year, term, attendance_date, class_id, student_id, subject_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_scope_identity ON staff_attendance(school_id, academic_year, term, attendance_date, staff_id, attendance_type);
