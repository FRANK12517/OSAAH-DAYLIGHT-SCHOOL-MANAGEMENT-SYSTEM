-- Part 4: attendance provenance, complete audit history, and server timestamps.
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS recorded_by TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS recorded_at TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS recorded_by TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS recorded_at TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT NULL;

UPDATE student_attendance SET recorded_by = entered_by WHERE recorded_by IS NULL;
UPDATE student_attendance SET recorded_at = entered_at WHERE recorded_at IS NULL;
UPDATE student_attendance SET updated_by = entered_by WHERE updated_by IS NULL;
UPDATE staff_attendance SET recorded_by = entered_by WHERE recorded_by IS NULL;
UPDATE staff_attendance SET recorded_at = created_at WHERE recorded_at IS NULL;
UPDATE staff_attendance SET updated_by = entered_by WHERE updated_by IS NULL;
UPDATE staff_attendance SET source = COALESCE(source, attendance_source, 'MANUAL') WHERE source IS NULL;

CREATE TABLE IF NOT EXISTS attendance_audit_history (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  attendance_record_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  person_type VARCHAR(16) NOT NULL,
  previous_status VARCHAR(32),
  new_status VARCHAR(32) NOT NULL,
  previous_reason TEXT,
  new_reason TEXT,
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL,
  source VARCHAR(32) NOT NULL,
  action VARCHAR(16) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_scope ON attendance_audit_history(school_id, attendance_record_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_person ON attendance_audit_history(school_id, person_id, changed_at);
