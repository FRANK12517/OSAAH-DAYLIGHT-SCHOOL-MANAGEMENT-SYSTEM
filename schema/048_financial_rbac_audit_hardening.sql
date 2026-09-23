-- Part 7: financial RBAC audit hardening. Additive and idempotent.
ALTER TABLE financial_audit_history
  ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(128) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_audit_transaction
  ON financial_audit_history(school_id, transaction_reference, changed_at);
