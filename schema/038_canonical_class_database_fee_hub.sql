-- Part 6: canonical Class Database + Fee Hub reconciliation.
-- Additive only: preserve existing students, enrollments, invoices, payments,
-- receipts, and fee structures. No DROP, DELETE, TRUNCATE, or duplicate master
-- student/class catalog is introduced by this migration.

-- Extend the existing canonical master student table with the fields required
-- by the Class Database contract. Existing application columns are preserved.
ALTER TABLE students ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR(100) NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100) NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(32) NOT NULL DEFAULT 'NOT_SPECIFIED';
ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_guardian_name VARCHAR(255) NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(50) NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_date DATE NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
UPDATE students SET full_name = TRIM(CONCAT_WS(' ', first_name, middle_name, last_name))
WHERE full_name IS NULL OR full_name = '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_school_permanent_id
  ON students (school_id, permanent_student_id);
CREATE INDEX IF NOT EXISTS idx_students_school_name
  ON students (school_id, full_name);
CREATE INDEX IF NOT EXISTS idx_students_school_parent_phone
  ON students (school_id, parent_phone);

-- Reconcile the existing class catalog; do not create a second classes table.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS school_id VARCHAR(64) NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS level VARCHAR(100) NULL;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_classes_school_sort
  ON classes (school_id, sort_order, id);

-- Keep one historical row per student/year while exposing the richer contract.
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS school_id VARCHAR(64) NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR(100) NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS class_name VARCHAR(100) NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_current TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS enrolled_at DATETIME NULL;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL;
CREATE INDEX IF NOT EXISTS idx_enrollment_class_database
  ON student_enrollments (school_id, academic_year, class_id, is_current);
CREATE INDEX IF NOT EXISTS idx_enrollment_permanent_student
  ON student_enrollments (school_id, permanent_student_id, academic_year);

-- Normalized fee account and ledger tables are introduced only because the
-- existing fee tables do not provide account, charge, discount, or receipt
-- history primitives. Existing fee_structures/invoices/payments remain intact.
CREATE TABLE IF NOT EXISTS student_fee_accounts (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  student_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  term VARCHAR(30) NOT NULL,
  class_id VARCHAR(64) NULL,
  class_name VARCHAR(100) NOT NULL,
  account_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_fee_account (school_id, permanent_student_id, academic_year, term),
  INDEX idx_fee_account_student (school_id, permanent_student_id),
  INDEX idx_fee_account_class (school_id, academic_year, term, class_id)
);

CREATE TABLE IF NOT EXISTS student_fee_charges (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  fee_structure_id VARCHAR(64) NULL,
  fee_type VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  due_date DATE NULL,
  charge_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_fee_charge_account (account_id),
  INDEX idx_fee_charge_student (school_id, permanent_student_id)
);

CREATE TABLE IF NOT EXISTS student_fee_discounts (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  charge_id VARCHAR(64) NULL,
  discount_type VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  approved_by VARCHAR(64) NULL,
  created_by VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_fee_discount_account (account_id),
  INDEX idx_fee_discount_student (school_id, permanent_student_id)
);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  invoice_number VARCHAR(100) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  term VARCHAR(30) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_invoice_number (school_id, invoice_number),
  INDEX idx_fee_invoice_student (school_id, permanent_student_id),
  INDEX idx_fee_invoice_period (school_id, academic_year, term)
);

CREATE TABLE IF NOT EXISTS fee_invoice_items (
  id VARCHAR(64) NOT NULL,
  invoice_id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  fee_type VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  unit_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_fee_invoice_item_invoice (invoice_id)
);

CREATE TABLE IF NOT EXISTS fee_payments (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  payment_reference VARCHAR(100) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  invoice_id VARCHAR(64) NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  term VARCHAR(30) NOT NULL,
  fee_type VARCHAR(100) NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(32) NOT NULL DEFAULT 'CASH',
  transaction_reference VARCHAR(150) NULL,
  payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by VARCHAR(64) NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_payment_reference (school_id, payment_reference),
  INDEX idx_fee_payment_student (school_id, permanent_student_id),
  INDEX idx_fee_payment_account (account_id),
  INDEX idx_fee_payment_date (school_id, payment_date)
);

CREATE TABLE IF NOT EXISTS fee_receipts (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  receipt_number VARCHAR(100) NOT NULL,
  payment_id VARCHAR(64) NOT NULL,
  invoice_id VARCHAR(64) NULL,
  account_id VARCHAR(64) NOT NULL,
  permanent_student_id VARCHAR(100) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  term VARCHAR(30) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL,
  previous_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  new_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  payment_method VARCHAR(32) NULL,
  received_by VARCHAR(64) NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(8) NOT NULL DEFAULT 'VALID',
  voided_at DATETIME NULL,
  voided_by VARCHAR(64) NULL,
  void_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fee_receipt_number (school_id, receipt_number),
  UNIQUE KEY uq_fee_receipt_payment (payment_id),
  INDEX idx_fee_receipt_student (school_id, permanent_student_id),
  INDEX idx_fee_receipt_date (school_id, issued_at)
);

CREATE TABLE IF NOT EXISTS financial_audit_log (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(64) NULL,
  permanent_student_id VARCHAR(100) NULL,
  description TEXT NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  ip_address VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_financial_audit_school (school_id),
  INDEX idx_financial_audit_student (school_id, permanent_student_id),
  INDEX idx_financial_audit_entity (entity_type, entity_id)
);

-- Canonical Class Database projections. They are intentionally views over the
-- existing master tables, so promotion changes enrollment while preserving ID.
CREATE OR REPLACE VIEW vw_class_database AS
SELECT e.school_id, e.academic_year, e.class_id, e.class_name,
       s.id AS student_id, s.permanent_student_id, s.full_name AS student_name,
       s.gender, s.parent_guardian_name,
       s.parent_phone AS registered_parent_phone_number,
       s.student_status, e.enrollment_status, e.is_current
FROM student_enrollments e
JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
WHERE s.student_status = 'ACTIVE' AND e.is_current = 1;

CREATE OR REPLACE VIEW vw_completed_class_database AS
SELECT e.school_id, e.academic_year, e.class_id, e.class_name,
       s.id AS student_id, s.permanent_student_id, s.full_name AS student_name,
       s.gender, s.parent_guardian_name, e.enrollment_status,
       e.enrolled_at, e.completed_at
FROM student_enrollments e
JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
WHERE e.is_current = 0 OR e.enrollment_status IN
  ('PROMOTED', 'REPEATED', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'COMPLETED');

CREATE OR REPLACE VIEW vw_student_fee_balances AS
SELECT a.account_id, a.school_id, a.student_id, a.permanent_student_id,
       s.full_name AS student_name, s.gender, s.parent_guardian_name,
       s.parent_phone AS registered_parent_phone_number, a.class_id,
       a.class_name, a.academic_year, a.term,
       COALESCE(c.total_charged, 0.00) AS total_fees,
       COALESCE(d.total_discount, 0.00) AS total_discount,
       COALESCE(p.total_paid, 0.00) AS total_paid,
       GREATEST(COALESCE(c.total_charged, 0.00) - COALESCE(d.total_discount, 0.00)
         - COALESCE(p.total_paid, 0.00), 0.00) AS balance,
       CASE WHEN COALESCE(c.total_charged, 0.00) - COALESCE(d.total_discount, 0.00)
         - COALESCE(p.total_paid, 0.00) <= 0 THEN 'PAID'
         WHEN COALESCE(p.total_paid, 0.00) > 0 THEN 'PARTIALLY_PAID'
         ELSE 'OUTSTANDING' END AS payment_status
FROM student_fee_accounts a
JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id
LEFT JOIN (SELECT account_id, SUM(amount) AS total_charged FROM student_fee_charges
           WHERE charge_status = 'ACTIVE' GROUP BY account_id) c ON c.account_id = a.id
LEFT JOIN (SELECT account_id, SUM(amount) AS total_discount FROM student_fee_discounts
           WHERE status = 'ACTIVE' GROUP BY account_id) d ON d.account_id = a.id
LEFT JOIN (SELECT account_id, SUM(amount) AS total_paid FROM fee_payments
           WHERE status = 'COMPLETED' GROUP BY account_id) p ON p.account_id = a.id;

CREATE OR REPLACE VIEW vw_fee_overview AS
SELECT school_id, academic_year, term, COUNT(*) AS total_student_accounts,
       SUM(total_fees) AS total_expected, SUM(total_discount) AS total_discounts,
       SUM(total_paid) AS total_collected, SUM(balance) AS total_outstanding,
       SUM(payment_status = 'PAID') AS fully_paid_students,
       SUM(payment_status = 'PARTIALLY_PAID') AS partially_paid_students,
       SUM(payment_status = 'OUTSTANDING') AS outstanding_students
FROM vw_student_fee_balances GROUP BY school_id, academic_year, term;

CREATE OR REPLACE VIEW vw_fee_arrears AS
SELECT * FROM vw_student_fee_balances WHERE balance > 0;

CREATE OR REPLACE VIEW vw_published_fee_structures AS
SELECT id, school_id, academic_year_id AS academic_year, term_id AS term,
       class_id, NULL AS class_name, fee_type, NULL AS category_name,
       NULL AS description, amount, 1 AS is_mandatory, NULL AS published_at,
       NULL AS published_by FROM fee_structures WHERE status = 'PUBLISHED';

CREATE OR REPLACE VIEW vw_fee_collection_summary AS
SELECT school_id, academic_year, term, class_name, DATE(payment_date) AS collection_date,
       COUNT(*) AS transaction_count, SUM(amount) AS amount_collected
FROM fee_payments WHERE status = 'COMPLETED'
GROUP BY school_id, academic_year, term, class_name, DATE(payment_date);
