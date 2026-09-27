-- One durable assessment record per canonical student and academic context.
-- Legacy report_cards and student_assessments remain unchanged; no backfill.
CREATE TABLE IF NOT EXISTS canonical_ges_assessments (
  id VARCHAR(191) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  student_id VARCHAR(191) NOT NULL,
  class_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(191) NOT NULL,
  term_id VARCHAR(191) NOT NULL,
  conduct VARCHAR(500) NULL,
  attitude VARCHAR(500) NULL,
  interest VARCHAR(500) NULL,
  class_teacher_remarks VARCHAR(1000) NULL,
  headteacher_remarks VARCHAR(1000) NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (school_id, student_id, class_id, academic_year_id, term_id),
  CONSTRAINT fk_canonical_ges_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_canonical_ges_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_canonical_ges_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_canonical_ges_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_canonical_ges_term FOREIGN KEY (term_id) REFERENCES terms(id)
);
