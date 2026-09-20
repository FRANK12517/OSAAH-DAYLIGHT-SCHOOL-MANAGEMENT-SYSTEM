-- Part 2 controlled schema upgrade.
-- Additive only: no DROP, TRUNCATE, DELETE, or key-type changes.
-- This migration prepares the canonical relational contracts without creating
-- duplicate users, classes, fee definitions, or authentication tables.

-- Canonical role rows are upserted per school. User assignments are unchanged;
-- Part 3 will resolve and validate existing identities against these roles.
INSERT INTO roles (id, school_id, role_key, role_name, oversight_rank, created_at, updated_at)
SELECT CONCAT('role-', LOWER(REPLACE(s.id, '_', '-')), '-', LOWER(REPLACE(r.role_key, '_', '-'))),
       s.id, r.role_key, r.role_name, r.oversight_rank,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM schools s
JOIN (
  SELECT 'PROPRIETOR' AS role_key, 'Proprietor' AS role_name, 100 AS oversight_rank
  UNION ALL SELECT 'SCHOOL_ADMIN', 'School Admin', 90
  UNION ALL SELECT 'HEADTEACHER', 'Headteacher', 80
  UNION ALL SELECT 'ASSISTANT_HEADTEACHER', 'Assistant Headteacher', 70
  UNION ALL SELECT 'ACCOUNTANT_BURSAR', 'Accountant / Bursar', 50
  UNION ALL SELECT 'TEACHER', 'Teacher', 40
) r
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  oversight_rank = VALUES(oversight_rank),
  updated_at = CURRENT_TIMESTAMP;

-- These indexes support school-scoped role resolution and preserve the existing
-- users -> user_roles -> roles architecture.
CREATE INDEX IF NOT EXISTS idx_users_school_status
  ON users (school_id, status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_user
  ON user_roles (role_id, user_id);
CREATE INDEX IF NOT EXISTS idx_roles_school_key
  ON roles (school_id, role_key);

-- The enrollment repository already writes this relationship, but older schema
-- sets did not materialize the table. It is additive and retains history.
CREATE TABLE IF NOT EXISTS student_enrollments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  term_id TEXT REFERENCES terms(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, class_id, academic_year_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_scope
  ON student_enrollments (academic_year_id, class_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student
  ON student_enrollments (student_id, academic_year_id);

-- Class IDs remain owned by the existing classes table. This table stores only
-- verified presentation aliases, so Primary 1 and Basic 1 cannot become two
-- class identities. No class row is inserted by this migration.
CREATE TABLE IF NOT EXISTS class_label_aliases (
  id TEXT NOT NULL PRIMARY KEY,
  school_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  canonical_label TEXT NOT NULL,
  display_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(school_id, class_id),
  UNIQUE(school_id, canonical_label)
);
CREATE INDEX IF NOT EXISTS idx_class_label_alias_class
  ON class_label_aliases (class_id);
CREATE INDEX IF NOT EXISTS idx_class_label_alias_school
  ON class_label_aliases (school_id);

-- Support the existing class/year and fee target lookup paths without changing
-- primary-key or foreign-key types in an unknown production schema.
CREATE INDEX IF NOT EXISTS idx_classes_level_order
  ON classes (level_id, display_order, id);
CREATE INDEX IF NOT EXISTS idx_fee_obligations_target_period
  ON fee_obligations (school_id, applicability_type, class_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_fee_obligations_structure_period
  ON fee_obligations (school_id, fee_structure_id, academic_year_id, term_id);

-- No user, student, enrollment, class, fee, payment, receipt, or audit row is
-- copied, deleted, or rewritten here. Production application is intentionally
-- not changed to use aliases until Part 3 verifies live class identities.
