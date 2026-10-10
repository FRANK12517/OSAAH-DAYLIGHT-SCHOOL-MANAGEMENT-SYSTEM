import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL('../schema/079_attendance_legacy_schema_compatibility.sql', import.meta.url);

test('attendance compatibility migration adds every field used by the durable reader', async () => {
  const sql = await readFile(migration, 'utf8');
  for (const column of [
    'attendance_date', 'subject_id', 'method', 'arrival_time', 'departure_time',
    'reason', 'version', 'entered_by', 'entered_at', 'updated_at'
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `missing ${column}`);
  }
  assert.match(sql, /MODIFY COLUMN attendance_date VARCHAR\(50\) NOT NULL/i);
  assert.match(sql, /idx_student_attendance_canonical_read/i);
});

test('attendance compatibility migration preserves legacy fields and uses only evidenced mappings', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /SET attendance_date = date/i);
  assert.match(sql, /SET entered_at = created_at/i);
  assert.match(sql, /recorded_at = COALESCE\(recorded_at, created_at\)/i);
  assert.match(sql, /updated_at = COALESCE\(updated_at, created_at\)/i);
  assert.doesNotMatch(sql, /SET reason\s*=\s*remarks/i);
  assert.doesNotMatch(sql, /DROP\s+(?:COLUMN|TABLE)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(sql, /legacy columns and values/i);
});

test('attendance compatibility migration is idempotent through additive guards', async () => {
  const sql = await readFile(migration, 'utf8');
  const guardedAdds = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS/g)].length;
  assert.equal(guardedAdds, 10);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/i);
});
