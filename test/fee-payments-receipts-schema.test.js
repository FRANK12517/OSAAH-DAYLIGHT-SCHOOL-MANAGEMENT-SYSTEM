import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('payment and receipt migration preserves unique references and reversal metadata', async () => {
  const sql = await readFile(new URL('../schema/044_fee_payments_receipts.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_fee_payments/);
  for (const field of ['account_id', 'invoice_id', 'permanent_student_id', 'academic_year_id', 'term_id', 'class_id', 'payment_reference', 'amount', 'payment_method', 'provider_reference', 'payment_date', 'status', 'received_by', 'reversed_by', 'reversed_at', 'reversal_reason']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /amount DECIMAL\(15,2\) NOT NULL/);
  assert.match(sql, /uq_student_fee_payment_reference/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_fee_receipts/);
  for (const field of ['payment_id', 'receipt_number', 'amount_paid', 'previous_balance', 'new_balance', 'issued_by', 'issued_at', 'voided_by', 'voided_at', 'void_reason']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /uq_student_fee_receipt_number/);
  assert.match(sql, /uq_student_fee_receipt_payment/);
  assert.match(sql, /idx_student_fee_receipt_student/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
