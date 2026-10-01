-- 062_assignments.sql
-- Additive durable teacher assignments. Production Apply requires explicit approval.
CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(64) NOT NULL,
  term_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  subject_id VARCHAR(64) NOT NULL,
  teacher_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  instructions TEXT NULL,
  assignment_date VARCHAR(32) NULL,
  due_date VARCHAR(32) NULL,
  recipient_scope VARCHAR(16) NOT NULL DEFAULT 'CLASS',
  recipient_student_ids JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  created_by VARCHAR(64) NOT NULL,
  published_by VARCHAR(64) NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  published_at VARCHAR(32) NULL,
  PRIMARY KEY (id),
  KEY idx_assignments_parent_scope (school_id, status, academic_year_id, term_id, class_id),
  CONSTRAINT fk_assignments_school FOREIGN KEY (school_id) REFERENCES schools(id)
);
CREATE TABLE IF NOT EXISTS assignment_files (
  id VARCHAR(64) NOT NULL,
  assignment_id VARCHAR(64) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  storage_reference VARCHAR(1024) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_assignment_files_assignment (school_id, assignment_id),
  CONSTRAINT fk_assignment_files_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_files_school FOREIGN KEY (school_id) REFERENCES schools(id)
);
