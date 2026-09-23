import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL('../schema/038_canonical_class_database_fee_hub.sql', import.meta.url);

test('canonical Class Database and Fee Hub migration is additive and non-duplicating', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(students|classes)\b/i);
  for (const marker of [
    'permanent_student_id',
    'student_enrollments',
    'student_fee_accounts',
    'student_fee_charges',
    'student_fee_discounts',
    'fee_invoices',
    'fee_invoice_items',
    'fee_payments',
    'fee_receipts',
    'financial_audit_log',
    'vw_class_database',
    'vw_completed_class_database',
    'vw_student_fee_balances',
    'vw_fee_overview',
    'vw_fee_arrears',
    'vw_fee_collection_summary'
  ]) assert.match(sql, new RegExp(marker));
  assert.ok((sql.match(/DECIMAL\(/g) ?? []).length >= 10);
  assert.match(sql, /UNIQUE KEY uq_student_fee_account/);
  assert.match(sql, /UNIQUE KEY uq_fee_receipt_payment/);
  assert.match(sql, /CREATE OR REPLACE VIEW vw_class_database/);
  assert.match(sql, /CREATE OR REPLACE VIEW vw_completed_class_database/);
});

test('canonical financial schema preserves historical payment and receipt state', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /status VARCHAR\(16\) NOT NULL DEFAULT 'COMPLETED'/);
  assert.match(sql, /status VARCHAR\(8\) NOT NULL DEFAULT 'VALID'/);
  assert.match(sql, /voided_at DATETIME NULL/);
  assert.match(sql, /void_reason VARCHAR\(255\) NULL/);
  assert.match(sql, /financial_audit_log/);
  assert.match(sql, /old_values JSON NULL/);
  assert.match(sql, /new_values JSON NULL/);
});
