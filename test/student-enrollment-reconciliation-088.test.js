import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const migrationUrl = new URL('../schema/088_backfill_unlinked_student_enrollments.sql', import.meta.url);

test('legacy student enrollment reconciliation is ordered, additive, scoped, and idempotent', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
  const migration = migrations.find(({ version }) => version === 88);
  assert.equal(migration?.name, '088_backfill_unlinked_student_enrollments.sql');
  assert.ok(migrations.findIndex(({ version }) => version === 88) > migrations.findIndex(({ version }) => version === 87));
  assert.match(sql, /INSERT INTO student_enrollments/);
  assert.match(sql, /s\.current_class_id/);
  assert.match(sql, /sp\.class_id/);
  assert.match(sql, /academic_years y[\s\S]*y\.starts_on AND y\.ends_on/);
  assert.match(sql, /NOT EXISTS[\s\S]*FROM student_enrollments e[\s\S]*e\.student_id = s\.id/);
  assert.match(sql, /'ACTIVE',[\s\S]*1/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP)\s+(?:students|student_profiles|student_enrollments)\b/i);
});
