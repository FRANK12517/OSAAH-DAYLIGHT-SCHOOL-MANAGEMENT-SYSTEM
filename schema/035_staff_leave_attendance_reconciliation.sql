-- Part 3: reconcile approved staff leave with canonical staff attendance.
-- Existing leave and attendance rows remain queryable and receive safe legacy defaults.
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS term VARCHAR(32) DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NULL;

ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(32) NOT NULL DEFAULT 'PRESENT';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS attendance_source VARCHAR(32) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS leave_request_id TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS previous_status VARCHAR(32) DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_leave_scope_state ON staff_leave(school_id, academic_year, term, state, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date ON staff_attendance(school_id, academic_year, term, staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_leave_link ON staff_attendance(school_id, leave_request_id, attendance_date);

CREATE TABLE IF NOT EXISTS staff_attendance_reconciliation_audit (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  leave_request_id TEXT NOT NULL REFERENCES staff_leave(id),
  staff_attendance_id TEXT REFERENCES staff_attendance(id),
  attendance_date TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status VARCHAR(32),
  next_status VARCHAR(32),
  details TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_reconciliation_audit_leave ON staff_attendance_reconciliation_audit(school_id, leave_request_id, attendance_date);
