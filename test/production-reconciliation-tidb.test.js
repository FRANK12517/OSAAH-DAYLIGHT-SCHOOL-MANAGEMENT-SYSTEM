import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production reconciliation uses bounded types for TiDB key columns', async () => {
  const sql = await readFile(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\bTEXT\s+PRIMARY\s+KEY\b/i);
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS fee_type_id TEXT\b/i);
  assert.match(sql, /id VARCHAR\(64\) PRIMARY KEY/);
  assert.match(sql, /academic_year_id VARCHAR\(64\) NULL, term_id VARCHAR\(64\) NULL/);
  assert.match(sql, /reference_id VARCHAR\(128\) DEFAULT NULL/);
});
