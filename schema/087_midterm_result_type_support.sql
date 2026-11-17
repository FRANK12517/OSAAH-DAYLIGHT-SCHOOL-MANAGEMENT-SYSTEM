-- Result type columns are VARCHAR in the durable lifecycle tables. This
-- additive index supports exact-scope Midterm/Terminal/Mock lifecycle reads
-- without rewriting any existing scores or result status records.
CREATE INDEX IF NOT EXISTS idx_academic_result_record_examination_scope
  ON academic_result_records (school_id(64), class_id(64), academic_year_id(64), term_id(64), examination, mock_label, status);

-- Keep existing Terminal and Mock blocks unchanged and allow Midterm keys.
ALTER TABLE academic_result_blocks
  MODIFY COLUMN result_type ENUM('TERMINAL','MOCK','MIDTERM') NOT NULL DEFAULT 'TERMINAL';
ALTER TABLE academic_result_unblock_requests
  MODIFY COLUMN result_type ENUM('TERMINAL','MOCK','MIDTERM') NOT NULL DEFAULT 'TERMINAL';
