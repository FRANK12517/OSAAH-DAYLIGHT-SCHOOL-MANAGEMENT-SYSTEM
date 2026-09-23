-- 044_fee_payments_receipts.sql
-- Canonical student fee payments and receipts.
-- Historical payment and receipt records are preserved; reversals are recorded
-- through status and reversal metadata rather than destructive updates.

CREATE TABLE IF NOT EXISTS student_fee_payments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  invoice_id TEXT DEFAULT NULL REFERENCES fee_invoices(id),
  permanent_student_id VARCHAR(128) NOT NULL,
  academic_year_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  payment_reference VARCHAR(128) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(32) NOT NULL,
  provider_reference VARCHAR(255) DEFAULT NULL,
  payment_date TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  received_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  reversed_by TEXT DEFAULT NULL REFERENCES users(id),
  reversed_at TEXT DEFAULT NULL,
  reversal_reason TEXT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_payment_reference
  ON student_fee_payments(school_id, payment_reference);

CREATE INDEX IF NOT EXISTS idx_student_fee_payment_account
  ON student_fee_payments(school_id, account_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_student_fee_payment_student
  ON student_fee_payments(school_id, permanent_student_id, academic_year_id, term_id);

CREATE TABLE IF NOT EXISTS student_fee_receipts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  payment_id TEXT NOT NULL REFERENCES student_fee_payments(id),
  account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  permanent_student_id VARCHAR(128) NOT NULL,
  receipt_number VARCHAR(128) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL,
  previous_balance DECIMAL(15,2) NOT NULL,
  new_balance DECIMAL(15,2) NOT NULL,
  issued_by TEXT NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'VALID',
  voided_by TEXT DEFAULT NULL REFERENCES users(id),
  voided_at TEXT DEFAULT NULL,
  void_reason TEXT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_number
  ON student_fee_receipts(school_id, receipt_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_payment
  ON student_fee_receipts(payment_id);

CREATE INDEX IF NOT EXISTS idx_student_fee_receipt_student
  ON student_fee_receipts(school_id, permanent_student_id, issued_at);
