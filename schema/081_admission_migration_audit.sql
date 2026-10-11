-- Auditable, resumable state for staff-triggered existing-student ID repair.
-- Student identity and enrollment remain owned by the canonical tables from
-- migrations 001-080. This migration adds operation metadata only.
CREATE TABLE IF NOT EXISTS admission_migration_batches (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL,
  request_key VARCHAR(128) NOT NULL,
  preview_fingerprint CHAR(64) NOT NULL,
  selection_fingerprint CHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  requested_count INT UNSIGNED NOT NULL DEFAULT 0,
  completed_count INT UNSIGNED NOT NULL DEFAULT 0,
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_admission_migration_request (school_id, request_key),
  KEY idx_admission_migration_school_status (school_id, status, updated_at)
);

CREATE TABLE IF NOT EXISTS admission_migration_items (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  source_student_id VARCHAR(191) NOT NULL,
  target_student_id VARCHAR(191) DEFAULT NULL,
  permanent_student_id VARCHAR(32) DEFAULT NULL,
  outcome VARCHAR(32) NOT NULL,
  reason_code VARCHAR(64) DEFAULT NULL,
  actor_user_id VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_admission_migration_batch_student (batch_id, source_student_id),
  KEY idx_admission_migration_item_school (school_id, outcome, updated_at)
);
