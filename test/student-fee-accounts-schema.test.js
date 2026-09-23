import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('student fee accounts preserve one canonical account per student period', async () => {
  const sql = await readFile(new URL('../schema/041_student_fee_accounts.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_fee_accounts/);
  for (const field of ['school_id', 'student_id', 'permanent_student_id', 'academic_year_id', 'term_id', 'class_id', 'account_status', 'created_by', 'created_at', 'updated_by', 'updated_at']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /uq_student_fee_account_scope/);
  assert.match(sql, /idx_student_fee_account_class/);
  assert.match(sql, /idx_student_fee_account_student/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
