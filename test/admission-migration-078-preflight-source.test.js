import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { columnDefinitionMismatch } from '../scripts/admissions-078-schema-contract.mjs';

const preflightPath = resolve('scripts/admission-workflow-migration-preflight.mjs');

test('Migration 078 production preflight is read-only and covers identity, sequence, relationships, and indexes', async () => {
  const source = await readFile(preflightPath, 'utf8');
  assert.doesNotMatch(source, /^\s*(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|REPLACE\s+INTO)\b/im);
  assert.match(source, /writesPerformed:\s*false/);
  assert.match(source, /SELECT VERSION\(\) AS server_version/);
  assert.match(source, /student_permanent_id/);
  assert.match(source, /annualSequenceReconciliation/);
  assert.match(source, /student_enrollment_students/);
  assert.match(source, /student_enrollment_classes/);
  assert.match(source, /student_enrollment_academic_years/);
  assert.match(source, /student_enrollment_terms/);
  assert.match(source, /indexDefinitionMismatches/);
  assert.match(source, /duplicateGroups/);
  assert.match(source, /columnDefinitionMismatch\(table, name, columnMetadata\.get\(keyFor\(table, name\)\)\)/);
  assert.doesNotMatch(source, /student_profiles:\s*\[[^\]]*permanent_student_id/);
});

test('VARCHAR(100) and VARCHAR(128) both satisfy the canonical permanent Student ID contract', () => {
  for (const type of ['varchar(100)', 'varchar(128)']) {
    assert.equal(columnDefinitionMismatch('admission_applications', 'permanent_student_id', { type, nullable: 'YES' }), null);
  }
  const mismatch = columnDefinitionMismatch('admission_applications', 'permanent_student_id', { type: 'varchar(32)', nullable: 'YES' });
  assert.equal(mismatch.expectedType, 'varchar(128)');
  assert.deepEqual(mismatch.expectedTypes, ['varchar(100)', 'varchar(128)']);
  assert.equal(mismatch.actualType, 'varchar(32)');
  assert.equal(columnDefinitionMismatch('admission_applications', 'permanent_student_id', { type: 'varchar(100)', nullable: 'NO' }).actualNullable, 'NO');
});

test('canonical migration history keeps Permanent Student ID on students and provides is_current in 054', async () => {
  const migration038 = await readFile(resolve('schema/038_canonical_class_database_fee_hub.sql'), 'utf8');
  const migration054 = await readFile(resolve('schema/054_durable_score_entry_academic_contract.sql'), 'utf8');
  assert.match(migration038, /ALTER TABLE students ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR\(100\) NULL/i);
  assert.match(migration054, /students\.permanent_student_id/);
  assert.match(migration054, /student_profiles\.student_id is the existing/i);
  assert.match(migration054, /compatibility bridge populated from that master value/i);
  assert.doesNotMatch(migration054, /ALTER TABLE student_profiles[^;]*permanent_student_id/i);
  assert.match(migration054, /ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_current TINYINT\(1\) NOT NULL DEFAULT 1/i);
});
