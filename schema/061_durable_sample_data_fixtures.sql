-- 061_durable_sample_data_fixtures.sql
-- Additive, isolated storage for controlled sample fixtures. This table is not
-- an enrollment, attendance, result, fee, payment, receipt, or reporting table.
-- No official records are backfilled or changed by this migration.
CREATE TABLE IF NOT EXISTS sample_data_fixtures (
  fixture_id VARCHAR(128) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  sample_student_id VARCHAR(64) NOT NULL,
  academic_year_id VARCHAR(64) NOT NULL,
  term_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  fixture_type VARCHAR(64) NOT NULL,
  fixture_payload JSON NOT NULL,
  fixture_version INT NOT NULL DEFAULT 1,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (fixture_id),
  UNIQUE KEY uq_sample_fixture_identity (
    school_id, sample_student_id, academic_year_id, term_id,
    class_id, fixture_type, fixture_version
  ),
  KEY idx_sample_fixture_context (
    school_id, sample_student_id, academic_year_id, term_id, class_id
  )
);
