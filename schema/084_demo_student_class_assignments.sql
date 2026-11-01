-- 084_demo_student_class_assignments.sql
-- Mark permanent demonstration student masters and make class availability
-- independent from a learner's single official enrollment for a given term.
-- This migration creates no student, enrollment, score, fee, or payment rows.
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_test_record TINYINT(1) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_students_school_demo_status
  ON students (school_id, is_test_record, student_status);

CREATE TABLE IF NOT EXISTS demo_student_class_assignments (
  school_id VARCHAR(64) NOT NULL,
  student_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (school_id, student_id, class_id),
  KEY idx_demo_student_class (school_id, class_id, student_id),
  CONSTRAINT fk_demo_assignment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_demo_assignment_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_demo_assignment_class FOREIGN KEY (class_id) REFERENCES classes(id)
);
