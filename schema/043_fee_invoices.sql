-- 043_fee_invoices.sql
-- Canonical fee invoices and invoice items.
-- Additive reconciliation: preserves existing invoices and historical amounts.

CREATE TABLE IF NOT EXISTS fee_invoices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  permanent_student_id VARCHAR(128) NOT NULL,
  academic_year_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  invoice_number VARCHAR(128) NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT DEFAULT NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  issued_by TEXT DEFAULT NULL REFERENCES users(id),
  issued_at TEXT DEFAULT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_by TEXT DEFAULT NULL REFERENCES users(id),
  updated_at TEXT DEFAULT NULL
);

-- Existing Fee Hub invoice rows retain their legacy academic_year/term and
-- student snapshot fields. New canonical period and audit columns are added
-- without deleting or rewriting those historical rows.
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS academic_year_id TEXT NULL;
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS term_id TEXT NULL;
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS class_id TEXT NULL;
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS issued_by TEXT NULL;
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS issued_at TEXT NULL;
ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_invoice_number
  ON fee_invoices(school_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_fee_invoice_student
  ON fee_invoices(school_id, permanent_student_id, academic_year_id, term_id);

CREATE INDEX IF NOT EXISTS idx_fee_invoice_account
  ON fee_invoices(school_id, account_id);

CREATE TABLE IF NOT EXISTS fee_invoice_items (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  invoice_id TEXT NOT NULL REFERENCES fee_invoices(id),
  fee_structure_id TEXT DEFAULT NULL,
  fee_type VARCHAR(128) NOT NULL,
  description TEXT DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE fee_invoice_items ADD COLUMN IF NOT EXISTS fee_structure_id TEXT NULL;
ALTER TABLE fee_invoice_items ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2) NULL;

CREATE INDEX IF NOT EXISTS idx_fee_invoice_items_invoice
  ON fee_invoice_items(school_id, invoice_id);
