-- 042_student_fee_ledger.sql
-- Financial source of truth for charge, discount, payment, reversal,
-- and adjustment transactions.

CREATE TABLE IF NOT EXISTS student_fee_ledger (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  permanent_student_id VARCHAR(128) NOT NULL,
  academic_year_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  transaction_type VARCHAR(32) NOT NULL,
  fee_type VARCHAR(128) DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  reference_type VARCHAR(64) DEFAULT NULL,
  reference_id TEXT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  transaction_date TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  reversed_by TEXT DEFAULT NULL REFERENCES users(id),
  reversed_at TEXT DEFAULT NULL,
  reversal_reason TEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_account
  ON student_fee_ledger(school_id, account_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_student
  ON student_fee_ledger(school_id, permanent_student_id, academic_year_id, term_id);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_type
  ON student_fee_ledger(school_id, transaction_type, transaction_date);

CREATE INDEX IF NOT EXISTS idx_fee_ledger_reference
  ON student_fee_ledger(school_id, reference_type, reference_id);
