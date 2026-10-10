-- Attendance schema compatibility repair for legacy production databases.
--
-- The legacy student_attendance table uses date/remarks/created_at and does not
-- contain the canonical reader fields. This migration is additive and keeps all
-- legacy columns and values. Historical authors, reasons, and times remain NULL
-- when the legacy schema did not record them; no identities or history are
-- fabricated.

ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS attendance_date VARCHAR(50) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS subject_id VARCHAR(191) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS method VARCHAR(32) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS arrival_time VARCHAR(50) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS departure_time VARCHAR(50) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS reason TEXT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS entered_by VARCHAR(191) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS entered_at VARCHAR(50) NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS updated_at VARCHAR(50) NULL;

-- date and created_at are the only legacy values with an evidenced canonical
-- correspondence. remarks is intentionally retained without being copied to
-- reason because the two fields have different documented semantics.
UPDATE student_attendance
SET attendance_date = date
WHERE attendance_date IS NULL;

UPDATE student_attendance
SET entered_at = created_at
WHERE entered_at IS NULL;

UPDATE student_attendance
SET recorded_at = COALESCE(recorded_at, created_at),
    updated_at = COALESCE(updated_at, created_at)
WHERE recorded_at IS NULL OR updated_at IS NULL;

ALTER TABLE student_attendance MODIFY COLUMN attendance_date VARCHAR(50) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_attendance_canonical_read
  ON student_attendance(school_id, academic_year, term, class_id, attendance_date, student_id);
