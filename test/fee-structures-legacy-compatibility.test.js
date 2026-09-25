import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url));

test('migration 049 preserves the deployed legacy fee_structures contract', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /idx_fee_structure_fee_type ON fee_structures\(school_id, fee_type_id, academic_year, term\)/);
  assert.match(sql, /academic_year AS academic_year_id/);
  assert.match(sql, /term AS term_id/);
  assert.match(sql, /category_name AS fee_type/);
  assert.doesNotMatch(sql, /idx_fee_structure_fee_type ON fee_structures\([^)]*academic_year_id/);
  assert.doesNotMatch(sql, /SELECT id, school_id, academic_year_id, term_id, class_id, fee_type, amount, status\s+FROM fee_structures/);
});

test('legacy fee structure repair remains additive and does not seed or delete data', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+fee_structures)\b/i);
  assert.match(sql, /ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS fee_type_id/);
  assert.match(sql, /ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS custom_fee_type_name/);
});
