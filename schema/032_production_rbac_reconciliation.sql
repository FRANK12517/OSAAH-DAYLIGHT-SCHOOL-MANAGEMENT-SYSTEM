-- Part 9 focused production RBAC reconciliation.
-- Preconditions are enforced by scripts/production-rbac-reconcile.mjs.
-- This migration must not be run against an unknown schema.
-- It never creates, alters, deletes, or replaces users or user_roles.

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(100) NOT NULL,
  school_id VARCHAR(191) NULL,
  role_key VARCHAR(100) NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  oversight_rank INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_school_key (school_id, role_key),
  KEY idx_roles_school (school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(150) NOT NULL,
  permission_key VARCHAR(150) NOT NULL,
  permission_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_key (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(100) NOT NULL,
  permission_id VARCHAR(150) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_role_permissions_permission (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO roles (id, school_id, role_key, role_name, oversight_rank)
SELECT CONCAT('role-', s.id, '-', LOWER(REPLACE(r.role_key, '_', '-'))), s.id, r.role_key, r.role_name, r.oversight_rank
FROM schools s
JOIN (
  SELECT 'PROPRIETOR' AS role_key, 'Proprietor' AS role_name, 100 AS oversight_rank
  UNION ALL SELECT 'SCHOOL_ADMIN', 'School Admin', 90
  UNION ALL SELECT 'HEADTEACHER', 'Headteacher', 80
  UNION ALL SELECT 'ASSISTANT_HEADTEACHER', 'Assistant Headteacher', 70
  UNION ALL SELECT 'ACCOUNTANT_BURSAR', 'Accountant / Bursar', 50
  UNION ALL SELECT 'TEACHER', 'Teacher', 40
) r;

INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES
  ('permission-wildcard', '*', 'Proprietor oversight'),
  ('permission-users-read', 'users.read', 'View users'),
  ('permission-settings-read', 'settings.read', 'View settings'),
  ('permission-students-read', 'students.read', 'View students'),
  ('permission-academics-read', 'academics.read', 'View academics'),
  ('permission-attendance-read', 'attendance.read', 'View attendance'),
  ('permission-attendance-write', 'attendance.write', 'Record attendance'),
  ('permission-examinations-read', 'examinations.read', 'View examinations'),
  ('permission-results-read', 'results.read', 'View results'),
  ('permission-results-generate', 'results.generate', 'Generate results'),
  ('permission-results-print', 'results.print', 'Print results'),
  ('permission-admissions-read', 'admissions.read', 'View admissions'),
  ('permission-admissions-review', 'admissions.review', 'Review admissions'),
  ('permission-admissions-accept', 'admissions.accept', 'Accept admissions'),
  ('permission-admissions-reject', 'admissions.reject', 'Reject admissions'),
  ('permission-admissions-analytics-read', 'admissions.analytics.read', 'View admission analytics'),
  ('permission-admission-prospectus-manage', 'admission.prospectus.manage', 'Manage admission prospectus'),
  ('permission-subjects-read', 'subjects.read', 'View subjects'),
  ('permission-subjects-manage', 'subjects.manage', 'Manage subjects'),
  ('permission-signatures-manage', 'signatures.manage', 'Manage signatures'),
  ('permission-mock-scores-read', 'mock.scores.read', 'View mock scores'),
  ('permission-mock-scores-write', 'mock.scores.write', 'Write mock scores'),
  ('permission-mock-results-read', 'mock.results.read', 'View mock results'),
  ('permission-mock-results-generate', 'mock.results.generate', 'Generate mock results'),
  ('permission-fees-read', 'fees.read', 'View fees'),
  ('permission-fees-write', 'fees.write', 'Write fees'),
  ('permission-finance-read', 'finance.read', 'View finance'),
  ('permission-fees-configure', 'fees.configure', 'Configure fees'),
  ('permission-fees-collect', 'fees.collect', 'Collect fees'),
  ('permission-staff-read', 'staff.read', 'View staff'),
  ('permission-staff-manage', 'staff.manage', 'Manage staff'),
  ('permission-communication-read', 'communication.read', 'View communication'),
  ('permission-documents-read', 'documents.read', 'View documents'),
  ('permission-reports-read', 'reports.read', 'View reports'),
  ('permission-marks-write', 'marks.write', 'Write marks'),
  ('permission-leave-read', 'leave.read', 'View leave'),
  ('permission-leave-write', 'leave.write', 'Manage leave'),
  ('permission-staff-professional-development-view', 'staff.professional-development.view', 'View professional development'),
  ('permission-messages-read', 'messages.read', 'Read messages'),
  ('permission-messages-write', 'messages.write', 'Send messages'),
  ('permission-sporting-view', 'sporting_activities.view', 'View sporting activities'),
  ('permission-sporting-create', 'sporting_activities.create', 'Create sporting activities'),
  ('permission-sporting-update', 'sporting_activities.update', 'Update sporting activities'),
  ('permission-sporting-delete', 'sporting_activities.delete', 'Delete sporting activities'),
  ('permission-sporting-fixtures', 'sporting_activities.manage_fixtures', 'Manage fixtures'),
  ('permission-sporting-results', 'sporting_activities.record_results', 'Record sporting results'),
  ('permission-sporting-participants', 'sporting_activities.manage_participants', 'Manage sporting participants'),
  ('permission-sporting-reports', 'sporting_activities.generate_reports', 'Generate sporting reports'),
  ('permission-subject-register-view', 'subject_register.view', 'View subject register'),
  ('permission-subject-register-manage', 'subject_register.manage', 'Manage subject register'),
  ('permission-subject-register-assign', 'subject_register.assign_teacher', 'Assign subject teachers'),
  ('permission-subject-register-activate', 'subject_register.activate', 'Activate subject register'),
  ('permission-subject-register-deactivate', 'subject_register.deactivate', 'Deactivate subject register'),
  ('permission-subject-register-copy', 'subject_register.copy_register', 'Copy subject register'),
  ('permission-shep-view', 'shep_activities.view', 'View SHEP activities'),
  ('permission-shep-create', 'shep_activities.create', 'Create SHEP activities'),
  ('permission-shep-update', 'shep_activities.update', 'Update SHEP activities'),
  ('permission-shep-participants', 'shep_activities.manage_participants', 'Manage SHEP participants'),
  ('permission-shep-screening', 'shep_activities.record_screening', 'Record SHEP screening'),
  ('permission-shep-referral', 'shep_activities.create_referral', 'Create SHEP referral'),
  ('permission-shep-followup', 'shep_activities.manage_followup', 'Manage SHEP follow-up'),
  ('permission-shep-reports', 'shep_activities.generate_reports', 'Generate SHEP reports');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.role_key = 'PROPRIETOR' AND p.permission_key = '*';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.permission_key IN ('users.read','settings.read','students.read','academics.read','attendance.read','examinations.read','fees.read','finance.read','staff.read','staff.manage','communication.read','documents.read','reports.read')
WHERE r.role_key = 'SCHOOL_ADMIN';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.permission_key IN ('students.read','academics.read','attendance.read','examinations.read','results.read','results.generate','results.print','admissions.read','admissions.review','admissions.accept','admissions.reject','admissions.analytics.read','admission.prospectus.manage','subjects.read','subjects.manage','signatures.manage','mock.scores.read','mock.scores.write','mock.results.read','mock.results.generate','fees.read','finance.read','staff.read','communication.read','reports.read','sporting_activities.view','sporting_activities.create','sporting_activities.update','sporting_activities.delete','sporting_activities.manage_fixtures','sporting_activities.record_results','sporting_activities.manage_participants','sporting_activities.generate_reports','subject_register.view','subject_register.manage','subject_register.assign_teacher','subject_register.activate','subject_register.deactivate','subject_register.copy_register','shep_activities.view','shep_activities.create','shep_activities.update','shep_activities.manage_participants','shep_activities.record_screening','shep_activities.create_referral','shep_activities.manage_followup','shep_activities.generate_reports')
WHERE r.role_key = 'HEADTEACHER';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.permission_key IN ('students.read','academics.read','attendance.read','examinations.read','results.read','results.generate','results.print','admissions.read','admissions.review','admissions.accept','admissions.reject','admissions.analytics.read','admission.prospectus.manage','subjects.read','subjects.manage','signatures.manage','mock.scores.read','mock.scores.write','mock.results.read','mock.results.generate','fees.read','finance.read','staff.read','communication.read','sporting_activities.view','sporting_activities.create','sporting_activities.update','sporting_activities.delete','sporting_activities.manage_fixtures','sporting_activities.record_results','sporting_activities.manage_participants','sporting_activities.generate_reports','subject_register.view','subject_register.manage','subject_register.assign_teacher','subject_register.activate','subject_register.deactivate','subject_register.copy_register')
WHERE r.role_key = 'ASSISTANT_HEADTEACHER';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.permission_key IN ('students.read','fees.read','fees.write','finance.read','fees.configure','fees.collect')
WHERE r.role_key = 'ACCOUNTANT_BURSAR';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.permission_key IN ('students.read','academics.read','attendance.read','attendance.write','examinations.read','marks.write','results.read','results.generate','results.print','mock.scores.read','mock.scores.write','mock.results.read','mock.results.generate','leave.read','leave.write','staff.professional-development.view','communication.read','messages.read','messages.write','sporting_activities.view','sporting_activities.create','sporting_activities.update','sporting_activities.manage_fixtures','sporting_activities.record_results','sporting_activities.manage_participants','sporting_activities.generate_reports','subject_register.view','shep_activities.view','shep_activities.create','shep_activities.update','shep_activities.manage_participants','shep_activities.record_screening','shep_activities.create_referral','shep_activities.manage_followup','shep_activities.generate_reports')
WHERE r.role_key = 'TEACHER';

-- Backfill only missing canonical mappings from the existing legacy users.role value.
-- Existing user_roles rows are never deleted or rewritten.
INSERT IGNORE INTO user_roles (id, user_id, role_id, created_at)
SELECT CONCAT('user-role-', u.id, '-', r.role_key), u.id, r.id, CURRENT_TIMESTAMP
FROM users u
JOIN roles r ON r.school_id = u.school_id
  AND r.role_key = CASE UPPER(REPLACE(REPLACE(u.role, '-', '_'), ' ', '_'))
    WHEN 'ADMINISTRATOR' THEN 'SCHOOL_ADMIN'
    WHEN 'SCHOOL_ADMINISTRATOR' THEN 'SCHOOL_ADMIN'
    WHEN 'ACCOUNTANT' THEN 'ACCOUNTANT_BURSAR'
    WHEN 'CLASSROOM_TEACHER' THEN 'TEACHER'
    ELSE UPPER(REPLACE(REPLACE(u.role, '-', '_'), ' ', '_'))
  END;
