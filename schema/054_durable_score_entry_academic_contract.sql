-- 054_durable_score_entry_academic_contract.sql
-- Additive compatibility contract for the durable admission -> enrollment -> Score Entry path.
-- This migration creates no academic data and assigns no subjects.

ALTER TABLE students ADD COLUMN IF NOT EXISTS current_class_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS student_master_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS student_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS updated_at VARCHAR(32) NULL;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR(128) NULL;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(64) NULL;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS link_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS updated_at VARCHAR(32) NULL;
CREATE INDEX IF NOT EXISTS idx_student_profiles_master_school ON student_profiles(school_id, student_master_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_permanent_school ON student_profiles(school_id, permanent_student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_durable_scope ON student_enrollments(school_id, academic_year_id, class_id, is_current, enrollment_status);
CREATE INDEX IF NOT EXISTS idx_subject_assignments_subject_class ON subject_class_assignments(school_id, subject_id, class_id, active);
