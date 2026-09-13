-- Repair migration for deployments where the permanent-ID sequence table from
-- migration 023 was not materialized. This matches the enrollment repository's
-- existing global-per-admission-year locking contract.
CREATE TABLE IF NOT EXISTS student_id_sequences (
  admission_year SMALLINT NOT NULL,
  next_sequence INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (admission_year),
  CONSTRAINT chk_student_id_sequence_positive CHECK (next_sequence >= 1)
);
