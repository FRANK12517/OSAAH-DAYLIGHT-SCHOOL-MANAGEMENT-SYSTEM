import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Fee Hub reporting views are server-backed and ledger-scoped', async () => {
  const sql = await readFile(new URL('../schema/046_fee_hub_reporting_views.sql', import.meta.url), 'utf8');
  for (const view of ['vw_student_fee_balances', 'vw_fee_overview', 'vw_fee_arrears', 'vw_invoice_receipt_register']) assert.match(sql, new RegExp(`CREATE OR REPLACE VIEW ${view}`));
  assert.match(sql, /FROM student_fee_accounts/);
  assert.match(sql, /LEFT JOIN student_fee_ledger/);
  assert.match(sql, /FROM student_fee_payments/);
  assert.match(sql, /student_fee_receipts/);
  assert.match(sql, /transaction_type = 'CHARGE'/);
  assert.match(sql, /transaction_type IN \('DISCOUNT', 'PAYMENT'\)/);
  assert.doesNotMatch(sql, /FROM\s+fee_collection_records/i);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
