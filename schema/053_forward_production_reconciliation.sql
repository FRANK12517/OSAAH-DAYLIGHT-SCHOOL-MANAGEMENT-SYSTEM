-- 053_forward_production_reconciliation.sql
-- Forward-only reconciliation for the verified production divergence:
-- 049 is absent, 050 and 051 are recorded, and 052 is not assumed applied.
-- This migration creates only current missing runtime objects. It does not replay history,
-- backfill financial data, alter existing tables, or add foreign keys to legacy contracts.

CREATE TABLE IF NOT EXISTS student_fee_receipts (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL,
  payment_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(128) NOT NULL,
  receipt_number VARCHAR(128) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL,
  previous_balance DECIMAL(15,2) NOT NULL,
  new_balance DECIMAL(15,2) NOT NULL,
  issued_by VARCHAR(64) NOT NULL,
  issued_at VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'VALID',
  voided_by VARCHAR(64) DEFAULT NULL,
  voided_at VARCHAR(32) DEFAULT NULL,
  void_reason TEXT DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_number ON student_fee_receipts(school_id, receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_payment ON student_fee_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_receipt_student ON student_fee_receipts(school_id, permanent_student_id, issued_at);

CREATE TABLE IF NOT EXISTS financial_audit_history (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(128) DEFAULT NULL,
  action VARCHAR(32) NOT NULL,
  previous_values JSON DEFAULT NULL,
  new_values JSON DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  changed_by VARCHAR(64) NOT NULL,
  changed_at VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_entity ON financial_audit_history(school_id, entity_type, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_financial_audit_student ON financial_audit_history(school_id, permanent_student_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_financial_audit_actor ON financial_audit_history(school_id, changed_by, changed_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  school_id VARCHAR(191) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32) DEFAULT NULL,
  last_used_at VARCHAR(32) DEFAULT NULL,
  UNIQUE(token_hash)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_school ON auth_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at, revoked_at);
