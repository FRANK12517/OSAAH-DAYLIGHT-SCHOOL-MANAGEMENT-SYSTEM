-- Authoritative durable score foundation for Score Entry, Results, Broadsheet,
-- and Mock Examination. This adds only the table used by src/durable-academic.js;
-- it does not create a competing score store or copy/overwrite any existing rows.
--
-- scope_key_hash is an internal generated uniqueness key. It covers every
-- service-level identity dimension, including NULL terminal mock_label. It
-- keeps the unique index within MySQL/TiDB key-size limits while preserving
-- the nullable mock_label contract used by the service.
CREATE TABLE IF NOT EXISTS academic_score_records (
  id VARCHAR(191) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  record_type VARCHAR(16) NOT NULL,
  mock_label VARCHAR(64) NULL,
  academic_year_id VARCHAR(191) NOT NULL,
  term_id VARCHAR(191) NOT NULL,
  class_id VARCHAR(191) NOT NULL,
  student_id VARCHAR(191) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  ca_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  ca_max DECIMAL(6,2) NOT NULL DEFAULT 50,
  examination_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  examination_max DECIMAL(6,2) NOT NULL DEFAULT 50,
  total_score DECIMAL(6,2) NOT NULL,
  grade VARCHAR(32) NULL,
  remark TEXT NULL,
  entered_by VARCHAR(191) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  scope_key_hash CHAR(64) GENERATED ALWAYS AS (
    SHA2(CONCAT(
      LENGTH(school_id), ':', school_id, '|',
      LENGTH(record_type), ':', record_type, '|',
      COALESCE(CONCAT(LENGTH(mock_label), ':', mock_label), '-1:'), '|',
      LENGTH(academic_year_id), ':', academic_year_id, '|',
      LENGTH(term_id), ':', term_id, '|',
      LENGTH(class_id), ':', class_id, '|',
      LENGTH(student_id), ':', student_id, '|',
      LENGTH(subject_id), ':', subject_id
    ), 256)
  ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_score_record_scope (scope_key_hash),
  KEY idx_academic_scores_lookup (school_id(64), record_type, academic_year_id(64), term_id(64), class_id(64), student_id(64)),
  KEY idx_academic_scores_subject_scope (school_id(64), record_type, academic_year_id(64), term_id(64), class_id(64), subject_id(64)),
  KEY idx_academic_scores_student_subject (school_id, student_id, subject_id),
  CONSTRAINT fk_academic_score_records_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_score_records_student FOREIGN KEY (student_id) REFERENCES student_profiles(id),
  CONSTRAINT fk_academic_score_records_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_academic_score_records_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_academic_score_records_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_academic_score_records_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_academic_score_records_entered_by FOREIGN KEY (entered_by) REFERENCES users(id)
);
