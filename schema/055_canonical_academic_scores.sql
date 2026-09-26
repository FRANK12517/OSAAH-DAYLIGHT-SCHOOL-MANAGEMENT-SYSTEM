-- One forward-only source for Score Entry, Result Slips, broadsheets and ranking.
-- Existing score tables are left intact; unknown legacy marks are not backfilled.
-- terms.id is used as term_id because application and schema contracts use that FK.
-- student_id references the canonical master students.id, never Permanent Student ID.
CREATE TABLE IF NOT EXISTS canonical_academic_scores (
  id VARCHAR(191) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  student_id VARCHAR(191) NOT NULL,
  class_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(191) NOT NULL,
  term_id VARCHAR(191) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  class_score DECIMAL(6,2) NOT NULL,
  exam_score DECIMAL(6,2) NOT NULL,
  total_score DECIMAL(6,2) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, class_id, academic_year_id, term_id, subject_id),
  CONSTRAINT fk_academic_score_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_score_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_academic_score_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_academic_score_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_academic_score_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_academic_score_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
