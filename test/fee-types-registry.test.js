import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CANONICAL_FEE_TYPES, createFeeTypeRegistry, normalizeFeeType } from '../src/fee-types.js';

test('canonical registry exposes broad school fee categories without duplicate aliases', () => {
  assert.ok(CANONICAL_FEE_TYPES.length >= 35);
  assert.equal(new Set(CANONICAL_FEE_TYPES.map((type) => type.code)).size, CANONICAL_FEE_TYPES.length);
  assert.equal(normalizeFeeType({ code: 'School Fee' }).code, 'TUITION');
  assert.equal(normalizeFeeType({ code: 'School Bus' }).code, 'TRANSPORT');
  assert.equal(normalizeFeeType({ code: 'Examination Fee' }).code, 'EXAMINATION');
});

test('Other fee names remain identifiable through save/read normalization', () => {
  const type = normalizeFeeType({ code: 'OTHER', customName: 'Cultural Festival Levy' });
  assert.equal(type.category, 'OTHER');
  assert.equal(type.displayName, 'Cultural Festival Levy');
  assert.throws(() => normalizeFeeType({ code: 'OTHER' }), /Custom fee type name is required/);
  const registry = createFeeTypeRegistry({ schoolId: 'school-a' });
  const created = registry.register({ code: 'OTHER', customName: 'Cultural Festival Levy' }, { id: 'u', schoolId: 'school-a' });
  assert.equal(registry.list().some((item) => item.displayName === created.displayName), true);
});

test('fee type migration adds normalized relationships without destructive changes', async () => {
  const sql = await readFile(new URL('../schema/047_fee_types_registry.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_types/);
  assert.match(sql, /ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS fee_type_id/);
  assert.match(sql, /ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS fee_type_id/);
  assert.match(sql, /custom_fee_type_name/);
  assert.match(sql, /idx_fee_collection_fee_type/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
