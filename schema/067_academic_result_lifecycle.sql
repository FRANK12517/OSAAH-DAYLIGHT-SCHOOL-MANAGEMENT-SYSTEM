-- 067_academic_result_lifecycle.sql
-- Additive lifecycle metadata for results whose authoritative marks remain in
-- academic_score_records. This migration never creates or reads a competing
-- score table and never backfills unknown historical result state.
CREATE TABLE IF NOT EXISTS academic_result_records (
  id VARCHAR(191) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  student_id VARCHAR(191) NOT NULL,
  class_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(191) NOT NULL,
  term_id VARCHAR(191) NOT NULL,
  examination VARCHAR(16) NOT NULL DEFAULT 'TERMINAL',
  mock_label VARCHAR(64) NULL,
  attendance_json JSON NULL,
  assessment_json JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'SAVED',
  version INT NOT NULL DEFAULT 1,
  saved_by VARCHAR(191) NOT NULL,
  saved_at VARCHAR(32) NOT NULL,
  published_by VARCHAR(191) NULL,
  published_at VARCHAR(32) NULL,
  updated_at VARCHAR(32) NOT NULL,
  scope_key_hash CHAR(64) GENERATED ALWAYS AS (
    SHA2(CONCAT(
      LENGTH(school_id), ':', school_id, '|',
      LENGTH(student_id), ':', student_id, '|',
      LENGTH(class_id), ':', class_id, '|',
      LENGTH(academic_year_id), ':', academic_year_id, '|',
      LENGTH(term_id), ':', term_id, '|',
      LENGTH(examination), ':', examination, '|',
      COALESCE(CONCAT(LENGTH(mock_label), ':', mock_label), '-1:')
    ), 256)
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_result_record_scope (scope_key_hash),
  KEY idx_academic_result_record_context (school_id(64), class_id(64), academic_year_id(64), term_id(64), examination, status),
  CONSTRAINT fk_academic_result_record_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_result_record_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_academic_result_record_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_academic_result_record_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_academic_result_record_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_academic_result_record_saved_by FOREIGN KEY (saved_by) REFERENCES users(id),
  CONSTRAINT fk_academic_result_record_published_by FOREIGN KEY (published_by) REFERENCES users(id)
);
