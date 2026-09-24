-- 049_production_schema_reconciliation.sql
-- Current-state forward-only reconciliation.
-- This is not a replay of historical migrations and performs no destructive operation.
-- Existing rows are preserved. Existing non-deterministic historical values remain nullable.

-- Durable attendance scope and provenance.
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS term VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS subject_key VARCHAR(128) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS term VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS attendance_source VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS leave_request_id TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS note TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS previous_status VARCHAR(32) DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS recorded_by TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS recorded_at TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NULL;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS recorded_by TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS recorded_at TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS updated_by TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NULL;
ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS term VARCHAR(32) DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS cancellation_reason TEXT DEFAULT NULL;
ALTER TABLE staff_leave ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_student_attendance_scope ON student_attendance(school_id, academic_year, term, class_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_scope ON staff_attendance(school_id, academic_year, term, attendance_date, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_leave_scope_state ON staff_leave(school_id, academic_year, term, state, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date ON staff_attendance(school_id, academic_year, term, staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_leave_link ON staff_attendance(school_id, leave_request_id(191), attendance_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_attendance_scope_identity ON student_attendance(school_id(64), academic_year(64), term(32), date, class_id(64), student_id(64), subject_key(128));
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_scope_identity ON staff_attendance(school_id, academic_year, term, attendance_date, staff_id, attendance_type);

CREATE TABLE IF NOT EXISTS attendance_audit_history (
  id VARCHAR(191) PRIMARY KEY,
  school_id VARCHAR(191) NOT NULL,
  attendance_record_id VARCHAR(191) NOT NULL,
  person_id VARCHAR(191) NOT NULL,
  person_type VARCHAR(16) NOT NULL,
  previous_status VARCHAR(32),
  new_status VARCHAR(32) NOT NULL,
  previous_reason TEXT,
  new_reason TEXT,
  changed_by VARCHAR(191) NOT NULL,
  changed_at VARCHAR(50) NOT NULL,
  source VARCHAR(32) NOT NULL,
  action VARCHAR(16) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_scope ON attendance_audit_history(school_id, attendance_record_id, changed_at(50));
CREATE INDEX IF NOT EXISTS idx_attendance_audit_person ON attendance_audit_history(school_id, person_id, changed_at(50));

CREATE TABLE IF NOT EXISTS staff_attendance_reconciliation_audit (
  id VARCHAR(191) PRIMARY KEY,
  school_id VARCHAR(191) NOT NULL,
  leave_request_id VARCHAR(191) NOT NULL,
  staff_attendance_id VARCHAR(191),
  attendance_date VARCHAR(50) NOT NULL,
  action TEXT NOT NULL,
  previous_status VARCHAR(32),
  next_status VARCHAR(32),
  details TEXT NOT NULL,
  actor_id VARCHAR(191),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_reconciliation_audit_leave ON staff_attendance_reconciliation_audit(school_id, leave_request_id, attendance_date(50));

-- Collection and correction support. Vacation Classes remains a collection period,
-- not a canonical academic term.
CREATE TABLE IF NOT EXISTS fee_obligations (
  id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, fee_structure_id VARCHAR(64) NOT NULL,
  academic_year_id VARCHAR(64), term_id VARCHAR(64), applicability_type VARCHAR(32) NOT NULL,
  class_id VARCHAR(64), student_id VARCHAR(64) NOT NULL, amount_minor BIGINT NOT NULL,
  due_date DATE, status VARCHAR(32) NOT NULL, published_by VARCHAR(64) NOT NULL,
  published_at DATETIME NOT NULL, idempotency_key VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_fee_obligation_scope (school_id, idempotency_key),
  KEY idx_fee_obligations_student (school_id, student_id)
);
CREATE TABLE IF NOT EXISTS fee_collection_records (
  id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, collection_type VARCHAR(32) NOT NULL,
  class_id VARCHAR(64), collection_date DATE NOT NULL, expected_amount_minor BIGINT,
  amount_received_minor BIGINT NOT NULL, recorded_by VARCHAR(64) NOT NULL, notes TEXT,
  academic_year_id VARCHAR(64), term_id VARCHAR(64), collection_period VARCHAR(32),
  fee_type_id VARCHAR(64), custom_fee_type_name VARCHAR(128), created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  KEY idx_fee_collections_period (school_id, collection_type, collection_date),
  KEY idx_fee_collections_period_scope (school_id, collection_type, academic_year_id, collection_period, collection_date)
);
CREATE TABLE IF NOT EXISTS fee_collection_corrections (
  id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, collection_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NOT NULL, reason TEXT NOT NULL, before_amount_received_minor BIGINT NOT NULL,
  after_amount_received_minor BIGINT NOT NULL, created_at DATETIME NOT NULL,
  KEY idx_fee_corrections_school (school_id), KEY idx_fee_corrections_collection (collection_id)
);

-- Current Fee Hub account, ledger, invoice, payment, receipt, audit, and fee-type support.
CREATE TABLE IF NOT EXISTS student_fee_accounts (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, student_id VARCHAR(191) NOT NULL,
  permanent_student_id VARCHAR(128) NOT NULL, academic_year_id VARCHAR(191) NULL, term_id VARCHAR(191) NULL,
  class_id VARCHAR(191) NOT NULL, account_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', created_by VARCHAR(191) NULL,
  created_at TEXT NOT NULL, updated_by TEXT NULL, updated_at TEXT NULL
);
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS collection_period VARCHAR(32) DEFAULT NULL;
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS fee_type_id VARCHAR(64) DEFAULT NULL;
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS custom_fee_type_name VARCHAR(128) DEFAULT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS academic_year_id TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS term_id TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS created_by TEXT NULL;
ALTER TABLE student_fee_accounts ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'DRAFT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_account_scope ON student_fee_accounts(school_id, permanent_student_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_account_class ON student_fee_accounts(school_id, academic_year_id, term_id, class_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_account_student ON student_fee_accounts(school_id, permanent_student_id);

CREATE TABLE IF NOT EXISTS student_fee_ledger (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, account_id VARCHAR(191) NOT NULL,
  permanent_student_id VARCHAR(128) NOT NULL, academic_year_id VARCHAR(191) NOT NULL, term_id VARCHAR(191) NOT NULL, class_id VARCHAR(191) NOT NULL,
  transaction_type VARCHAR(32) NOT NULL, fee_type VARCHAR(128) DEFAULT NULL, amount DECIMAL(15,2) NOT NULL,
  reference_type VARCHAR(64) DEFAULT NULL, reference_id VARCHAR(191) DEFAULT NULL, description TEXT DEFAULT NULL,
  transaction_date VARCHAR(50) NOT NULL, source VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED', recorded_by VARCHAR(191) NOT NULL,
  recorded_at TEXT NOT NULL, reversed_by TEXT DEFAULT NULL, reversed_at TEXT DEFAULT NULL,
  reversal_reason TEXT DEFAULT NULL, status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_account ON student_fee_ledger(school_id, account_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_student ON student_fee_ledger(school_id, permanent_student_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_type ON student_fee_ledger(school_id, transaction_type, transaction_date);
CREATE INDEX IF NOT EXISTS idx_fee_ledger_reference ON student_fee_ledger(school_id, reference_type, reference_id);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, account_id VARCHAR(191) NOT NULL,
  permanent_student_id VARCHAR(128) NOT NULL, academic_year_id VARCHAR(191) NULL, term_id VARCHAR(191) NULL, class_id VARCHAR(191) NULL,
  invoice_number VARCHAR(128) NOT NULL, invoice_date VARCHAR(50) NOT NULL, due_date VARCHAR(50) DEFAULT NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0.00, discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00, status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  issued_by VARCHAR(191) DEFAULT NULL, issued_at VARCHAR(50) DEFAULT NULL, created_by VARCHAR(191) NOT NULL,
  created_at VARCHAR(50) NOT NULL, updated_by VARCHAR(191) DEFAULT NULL, updated_at VARCHAR(50) DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_invoice_number ON fee_invoices(school_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_fee_invoice_student ON fee_invoices(school_id, permanent_student_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_fee_invoice_account ON fee_invoices(school_id, account_id);
CREATE TABLE IF NOT EXISTS fee_invoice_items (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, invoice_id VARCHAR(191) NOT NULL,
  fee_structure_id VARCHAR(191) DEFAULT NULL, fee_type VARCHAR(128) NOT NULL, description TEXT DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL, created_at VARCHAR(50) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fee_invoice_items_invoice ON fee_invoice_items(school_id, invoice_id);

CREATE TABLE IF NOT EXISTS student_fee_payments (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, account_id VARCHAR(191) NOT NULL,
  invoice_id VARCHAR(191) DEFAULT NULL, permanent_student_id VARCHAR(128) NOT NULL,
  academic_year_id VARCHAR(191) NOT NULL, term_id VARCHAR(191) NOT NULL, class_id VARCHAR(191) NOT NULL, payment_reference VARCHAR(128) NOT NULL,
  amount DECIMAL(15,2) NOT NULL, payment_method VARCHAR(32) NOT NULL, provider_reference VARCHAR(255) DEFAULT NULL,
  payment_date VARCHAR(50) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED', received_by VARCHAR(191) NOT NULL,
  created_at VARCHAR(50) NOT NULL, reversed_by VARCHAR(191) DEFAULT NULL, reversed_at VARCHAR(50) DEFAULT NULL, reversal_reason TEXT DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_payment_reference ON student_fee_payments(school_id, payment_reference);
CREATE INDEX IF NOT EXISTS idx_student_fee_payment_account ON student_fee_payments(school_id, account_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_student_fee_payment_student ON student_fee_payments(school_id, permanent_student_id, academic_year_id, term_id);

CREATE TABLE IF NOT EXISTS student_fee_receipts (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, payment_id VARCHAR(191) NOT NULL,
  account_id VARCHAR(191) NOT NULL, permanent_student_id VARCHAR(128) NOT NULL,
  receipt_number VARCHAR(128) NOT NULL, amount_paid DECIMAL(15,2) NOT NULL, previous_balance DECIMAL(15,2) NOT NULL,
  new_balance DECIMAL(15,2) NOT NULL, issued_by VARCHAR(191) NOT NULL, issued_at VARCHAR(50) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'VALID', voided_by VARCHAR(191) DEFAULT NULL, voided_at VARCHAR(50) DEFAULT NULL, void_reason TEXT DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_number ON student_fee_receipts(school_id, receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_receipt_payment ON student_fee_receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_student_fee_receipt_student ON student_fee_receipts(school_id, permanent_student_id, issued_at);

CREATE TABLE IF NOT EXISTS financial_audit_history (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(191) NOT NULL, permanent_student_id VARCHAR(128) DEFAULT NULL, action VARCHAR(32) NOT NULL,
  previous_values JSON DEFAULT NULL, new_values JSON DEFAULT NULL, reason TEXT DEFAULT NULL,
  changed_by VARCHAR(191) NOT NULL, changed_at VARCHAR(50) NOT NULL, source VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  transaction_reference VARCHAR(128) DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_entity ON financial_audit_history(school_id, entity_type, entity_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_financial_audit_student ON financial_audit_history(school_id, permanent_student_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_financial_audit_actor ON financial_audit_history(school_id, changed_by, changed_at);
CREATE INDEX IF NOT EXISTS idx_financial_audit_transaction ON financial_audit_history(school_id, transaction_reference, changed_at);

CREATE TABLE IF NOT EXISTS fee_types (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL, code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL, category VARCHAR(64) NOT NULL, description TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (school_id, code)
);
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS fee_type_id TEXT DEFAULT NULL;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS custom_fee_type_name TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_types_scope ON fee_types(school_id, is_active, code);
CREATE INDEX IF NOT EXISTS idx_fee_structure_fee_type ON fee_structures(school_id, fee_type_id, academic_year_id, term_id);

-- Reporting views are additive projections over the current financial source of truth.
CREATE OR REPLACE VIEW vw_student_fee_balances AS
SELECT a.id AS account_id, a.school_id, a.student_id, a.permanent_student_id, a.academic_year_id, a.term_id, a.class_id,
COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' AND l.transaction_type = 'CHARGE' THEN l.amount ELSE 0 END), 0) AS total_charged,
COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' AND l.transaction_type = 'DISCOUNT' THEN l.amount ELSE 0 END), 0) AS total_discount,
COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' AND l.transaction_type = 'PAYMENT' THEN l.amount ELSE 0 END), 0) AS total_paid,
COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' AND l.transaction_type = 'CHARGE' THEN l.amount WHEN l.status = 'ACTIVE' AND l.transaction_type IN ('DISCOUNT', 'PAYMENT') THEN -l.amount ELSE 0 END), 0) AS balance
FROM student_fee_accounts a LEFT JOIN student_fee_ledger l ON l.account_id = a.id AND l.school_id = a.school_id
GROUP BY a.id, a.school_id, a.student_id, a.permanent_student_id, a.academic_year_id, a.term_id, a.class_id;
CREATE OR REPLACE VIEW vw_fee_overview AS SELECT school_id, academic_year_id, term_id, COUNT(*) AS student_accounts, SUM(total_charged) AS expected_fees, SUM(total_discount) AS discounts, SUM(total_paid) AS collected, SUM(balance) AS outstanding FROM vw_student_fee_balances GROUP BY school_id, academic_year_id, term_id;
CREATE OR REPLACE VIEW vw_fee_arrears AS SELECT * FROM vw_student_fee_balances WHERE balance > 0;
CREATE OR REPLACE VIEW vw_published_fee_structures AS
SELECT id, school_id, academic_year_id, term_id, class_id, fee_type, amount, status
FROM fee_structures WHERE status = 'PUBLISHED';
CREATE OR REPLACE VIEW vw_invoice_receipt_register AS
SELECT p.school_id, p.permanent_student_id, p.academic_year_id, p.term_id, p.class_id,
       i.invoice_number, p.payment_reference, r.receipt_number, p.amount AS amount_paid,
       p.payment_method, p.payment_date, r.previous_balance, r.new_balance, r.issued_at,
       p.status AS payment_status, r.status AS receipt_status
FROM student_fee_payments p
LEFT JOIN fee_invoices i ON i.id = p.invoice_id AND i.school_id = p.school_id
LEFT JOIN student_fee_receipts r ON r.payment_id = p.id AND r.school_id = p.school_id;
CREATE OR REPLACE VIEW vw_fee_collection_summary AS
SELECT school_id, collection_type, academic_year_id, term_id, collection_period,
       collection_date, COUNT(*) AS transaction_count, SUM(amount_received_minor) AS amount_received_minor
FROM fee_collection_records GROUP BY school_id, collection_type, academic_year_id, term_id, collection_period, collection_date;
