-- Part 1: permanent student identifiers. This migration is additive only.
-- Run the preflight/backfill workflow before making permanent_student_id NOT NULL.
ALTER TABLE student_profiles
  ADD COLUMN permanent_student_id VARCHAR(32) NULL;

CREATE UNIQUE INDEX uq_student_profiles_permanent_student_id
  ON student_profiles (permanent_student_id);

-- A row is locked with SELECT ... FOR UPDATE by the enrolment repository while
-- allocating an identifier. The counter is never decremented or reused.
CREATE TABLE IF NOT EXISTS student_id_sequences (
  admission_year SMALLINT NOT NULL,
  next_sequence INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (admission_year),
  CONSTRAINT chk_student_id_sequence_positive CHECK (next_sequence >= 1)
);
