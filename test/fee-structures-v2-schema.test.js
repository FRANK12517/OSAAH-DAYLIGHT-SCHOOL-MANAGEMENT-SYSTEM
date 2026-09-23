import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fee structures v2 is a canonical published structure table', async () => {
  const sql = await readFile(new URL('../schema/040_fee_structures_v2.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_structures_v2/);
  assert.match(sql, /amount DECIMAL\(15,2\) NOT NULL DEFAULT 0\.00/);
  assert.match(sql, /mandatory BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(sql, /status VARCHAR\(32\) NOT NULL DEFAULT 'DRAFT'/);
  for (const field of ['academic_year_id', 'term_id', 'class_id', 'fee_type', 'created_by', 'created_at', 'updated_by', 'updated_at']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  for (const index of ['idx_fee_structures_v2_scope', 'idx_fee_structures_v2_status', 'idx_fee_structures_v2_type']) assert.match(sql, new RegExp(index));
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
