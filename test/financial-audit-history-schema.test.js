import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('financial audit history preserves before/after values and actor history', async () => {
  const sql = await readFile(new URL('../schema/045_financial_audit_history.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS financial_audit_history/);
  for (const field of ['entity_type', 'entity_id', 'permanent_student_id', 'action', 'previous_values', 'new_values', 'reason', 'changed_by', 'changed_at', 'source']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /previous_values JSON/);
  assert.match(sql, /new_values JSON/);
  for (const index of ['idx_financial_audit_entity', 'idx_financial_audit_student', 'idx_financial_audit_actor']) assert.match(sql, new RegExp(index));
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
