-- 041_student_fee_accounts.sql
-- STUDENT FINANCIAL ACCOUNT
-- Additive reconciliation: migration 038 may already have created the
-- student_fee_accounts table with legacy academic_year/term columns.

CREATE TABLE IF NOT EXISTS student_fee_accounts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL,
  permanent_student_id VARCHAR(128) NOT NULL,
  academic_year_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  account_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_by TEXT DEFAULT NULL REFERENCES users(id),
  updated_at TEXT DEFAULT NULL
);

-- Reconcile accounts created by the prior canonical Fee Hub migration without
-- deleting or rewriting historical account rows. These remain nullable until
-- existing production rows have been backfilled with their authoritative actor
-- and academic period values.
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS academic_year_id TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS term_id TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS created_by TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_account_scope
  ON student_fee_accounts(school_id, permanent_student_id, academic_year_id, term_id);

CREATE INDEX IF NOT EXISTS idx_student_fee_account_class
  ON student_fee_accounts(school_id, academic_year_id, term_id, class_id);

CREATE INDEX IF NOT EXISTS idx_student_fee_account_student
  ON student_fee_accounts(school_id, permanent_student_id);
