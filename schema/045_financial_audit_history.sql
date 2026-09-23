-- 045_financial_audit_history.sql
-- Append-only financial audit history for invoice, ledger, payment, receipt,
-- account, and fee-structure changes.

CREATE TABLE IF NOT EXISTS financial_audit_history (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  entity_type VARCHAR(64) NOT NULL,
  entity_id TEXT NOT NULL,
  permanent_student_id VARCHAR(128) DEFAULT NULL,
  action VARCHAR(32) NOT NULL,
  previous_values JSON DEFAULT NULL,
  new_values JSON DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  changed_at TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_entity
  ON financial_audit_history(school_id, entity_type, entity_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_financial_audit_student
  ON financial_audit_history(school_id, permanent_student_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_financial_audit_actor
  ON financial_audit_history(school_id, changed_by, changed_at);
