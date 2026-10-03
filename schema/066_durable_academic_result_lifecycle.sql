-- Durable result lifecycle metadata for the canonical academic score path.
-- Scores remain in canonical_academic_scores and GES assessment text remains in
-- canonical_ges_assessments; this table stores only save/publication state.
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
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_result_record_scope (school_id, student_id, class_id, academic_year_id, term_id, examination, mock_label),
  KEY idx_academic_result_record_context (school_id, class_id, academic_year_id, term_id, examination, status)
);
