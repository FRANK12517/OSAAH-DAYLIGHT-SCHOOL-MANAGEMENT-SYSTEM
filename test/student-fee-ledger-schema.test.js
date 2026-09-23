import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('student fee ledger is the period-scoped financial source of truth', async () => {
  const sql = await readFile(new URL('../schema/042_student_fee_ledger.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_fee_ledger/);
  for (const field of ['account_id', 'permanent_student_id', 'academic_year_id', 'term_id', 'class_id', 'transaction_type', 'fee_type', 'amount', 'reference_type', 'reference_id', 'transaction_date', 'source', 'recorded_by', 'recorded_at', 'reversed_by', 'reversed_at', 'reversal_reason', 'status']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /amount DECIMAL\(15,2\) NOT NULL/);
  for (const index of ['idx_fee_ledger_account', 'idx_fee_ledger_student', 'idx_fee_ledger_type', 'idx_fee_ledger_reference']) assert.match(sql, new RegExp(index));
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
