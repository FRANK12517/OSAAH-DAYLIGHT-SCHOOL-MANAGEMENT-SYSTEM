-- 066_subject_class_assignments_reconciliation.sql
-- Additive reconciliation for installations where the legacy class_subjects
-- mapping exists but the normalized subject_class_assignments table is absent.
-- This migration never drops, updates, or deletes existing records.
CREATE TABLE IF NOT EXISTS subject_class_assignments (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  class_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(191) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  configuration_version VARCHAR(32) NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subject_class_assignment_scope (school_id, subject_id, class_id, academic_year_id),
  KEY idx_subject_class_assignments_lookup (school_id, class_id, academic_year_id, active),
  CONSTRAINT fk_subject_class_assignments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_subject_class_assignments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_subject_class_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_subject_class_assignments_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
);

-- Legacy class_subjects is authoritative when present. Derive school scope from
-- the canonical class and subject rows, and refuse cross-school relationships.
-- SHA2 gives a deterministic retry-safe ID without overwriting any row.
INSERT IGNORE INTO subject_class_assignments
  (id, school_id, subject_id, class_id, academic_year_id, active,
   configuration_version, created_at, updated_at)
SELECT
  SHA2(CONCAT('subject-class-assignment:', c.school_id, ':', cs.subject_id, ':', cs.class_id), 256),
  c.school_id,
  cs.subject_id,
  cs.class_id,
  NULL,
  1,
  '066-legacy-class-subjects',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM class_subjects cs
JOIN classes c ON c.id = cs.class_id
JOIN subjects s ON s.id = cs.subject_id AND s.school_id = c.school_id
WHERE NOT EXISTS (
  SELECT 1
  FROM subject_class_assignments a
  WHERE a.school_id = c.school_id
    AND a.subject_id = cs.subject_id
    AND a.class_id = cs.class_id
    AND a.academic_year_id IS NULL
);
