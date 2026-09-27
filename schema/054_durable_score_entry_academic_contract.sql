-- 054_durable_score_entry_academic_contract.sql
-- Corrected, additive compatibility contract for the durable admission ->
-- enrollment -> Score Entry path. Production keeps the Permanent Student ID on
-- students.permanent_student_id; student_profiles.student_id is the existing
-- compatibility bridge populated from that master value. Do not create a
-- second profile-level identity column.
--
-- subject_class_assignments belongs to migration 017. Some production
-- installations use the legacy class_subjects mapping instead, so this
-- migration does not create a duplicate mapping table or index a table it does
-- not own. The Result Slip subject reader has a school-scoped legacy fallback.
--
-- This migration creates no academic result data and performs no row backfill.

ALTER TABLE students ADD COLUMN IF NOT EXISTS current_class_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS student_master_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS student_id VARCHAR(191) NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS updated_at VARCHAR(32) NULL;
-- These three fields are part of the established enrollment contract in 038.
-- Re-add them here only when a historical production baseline omitted them;
-- their definitions are kept identical to migration 038.
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS school_id VARCHAR(64) NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_current TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR(128) NULL;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(64) NULL;
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS link_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE parent_student_links ADD COLUMN IF NOT EXISTS updated_at VARCHAR(32) NULL;
CREATE INDEX IF NOT EXISTS idx_student_profiles_master_school ON student_profiles(school_id, student_master_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_student_id_school ON student_profiles(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_durable_scope ON student_enrollments(school_id, academic_year_id, class_id, is_current, enrollment_status);
