-- 046_fee_hub_reporting_views.sql
-- Server-backed Fee Hub reporting projections.
-- Extra Classes and Canteen remain on fee_collection_records/037; these views
-- cover ordinary student fees only.

CREATE OR REPLACE VIEW vw_student_fee_balances AS
SELECT
  a.id AS account_id,
  a.school_id,
  a.student_id,
  a.permanent_student_id,
  a.academic_year_id,
  a.term_id,
  a.class_id,
  COALESCE(SUM(CASE
    WHEN l.status = 'ACTIVE' AND l.transaction_type = 'CHARGE' THEN l.amount
    ELSE 0 END), 0) AS total_charged,
  COALESCE(SUM(CASE
    WHEN l.status = 'ACTIVE' AND l.transaction_type = 'DISCOUNT' THEN l.amount
    ELSE 0 END), 0) AS total_discount,
  COALESCE(SUM(CASE
    WHEN l.status = 'ACTIVE' AND l.transaction_type = 'PAYMENT' THEN l.amount
    ELSE 0 END), 0) AS total_paid,
  COALESCE(SUM(CASE
    WHEN l.status = 'ACTIVE' AND l.transaction_type = 'CHARGE' THEN l.amount
    WHEN l.status = 'ACTIVE' AND l.transaction_type IN ('DISCOUNT', 'PAYMENT') THEN -l.amount
    ELSE 0 END), 0) AS balance
FROM student_fee_accounts a
LEFT JOIN student_fee_ledger l
  ON l.account_id = a.id AND l.school_id = a.school_id
GROUP BY a.id, a.school_id, a.student_id, a.permanent_student_id,
         a.academic_year_id, a.term_id, a.class_id;

CREATE OR REPLACE VIEW vw_fee_overview AS
SELECT school_id, academic_year_id, term_id,
       COUNT(*) AS student_accounts,
       SUM(total_charged) AS expected_fees,
       SUM(total_discount) AS discounts,
       SUM(total_paid) AS collected,
       SUM(balance) AS outstanding
FROM vw_student_fee_balances
GROUP BY school_id, academic_year_id, term_id;

CREATE OR REPLACE VIEW vw_fee_arrears AS
SELECT * FROM vw_student_fee_balances WHERE balance > 0;

CREATE OR REPLACE VIEW vw_invoice_receipt_register AS
SELECT
  p.school_id,
  p.permanent_student_id,
  p.academic_year_id,
  p.term_id,
  p.class_id,
  i.invoice_number,
  p.payment_reference,
  r.receipt_number,
  p.amount AS amount_paid,
  p.payment_method,
  p.payment_date,
  r.previous_balance,
  r.new_balance,
  r.issued_at,
  p.status AS payment_status,
  r.status AS receipt_status
FROM student_fee_payments p
LEFT JOIN fee_invoices i
  ON i.id = p.invoice_id AND i.school_id = p.school_id
LEFT JOIN student_fee_receipts r
  ON r.payment_id = p.id AND r.school_id = p.school_id;
