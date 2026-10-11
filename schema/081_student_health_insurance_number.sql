-- Additive canonical health-insurance field for the master student identity.
-- NULL preserves existing records and does not invent coverage data.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS health_insurance_number VARCHAR(64) NULL;
CREATE INDEX IF NOT EXISTS idx_students_health_insurance
  ON students (school_id, health_insurance_number);
