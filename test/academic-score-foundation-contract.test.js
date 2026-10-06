import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations, createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const schema = await readFile(new URL('../schema/068_academic_score_records_foundation.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8');
const migrationScript = await readFile(new URL('../scripts/production-academic-score-foundation-migrate.mjs', import.meta.url), 'utf8');
const lifecycleScript = await readFile(new URL('../scripts/production-academic-result-lifecycle-migrate.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-academic-score-foundation-migration-068.yml', import.meta.url), 'utf8');

test('Migration 068 is uniquely numbered and has a stable checksum for the committed SQL', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const foundation = migrations.find((item) => item.version === 68);
  assert.ok(foundation);
  assert.equal(foundation.name, '068_academic_score_records_foundation.sql');
  assert.equal(foundation.checksum, createHash('sha256').update(schema).digest('hex'));
  assert.deepEqual(migrations.slice(-4).map((item) => item.version), [69, 70, 71, 72]);
  assert.equal(migrations.at(-3).name, '070_school_admin_score_entry_permission.sql');
  assert.equal(migrations.at(-2).name, '071_school_admin_results_reports_permission.sql');
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
});

test('schema matches the durable service and uses student_profiles.id as score owner', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS academic_score_records/i);
  for (const column of ['id','school_id','record_type','mock_label','academic_year_id','term_id','class_id','student_id','subject_id','ca_score','ca_max','examination_score','examination_max','total_score','grade','remark','entered_by','updated_at']) {
    assert.match(schema, new RegExp(`\\b${column}\\b`, 'i'));
    assert.match(service, new RegExp(`\\b${column}\\b`, 'i'));
  }
  assert.match(schema, /FOREIGN KEY \(student_id\) REFERENCES student_profiles\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(school_id\) REFERENCES schools\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(class_id\) REFERENCES classes\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(academic_year_id\) REFERENCES academic_years\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(term_id\) REFERENCES terms\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(subject_id\) REFERENCES subjects\(id\)/i);
  assert.match(schema, /FOREIGN KEY \(entered_by\) REFERENCES users\(id\)/i);
  assert.match(schema, /scope_key_hash CHAR\(64\) GENERATED ALWAYS AS/i);
  assert.match(schema, /UNIQUE KEY uq_academic_score_record_scope \(scope_key_hash\)/i);
  assert.match(schema, /school_id\(64\), record_type, academic_year_id\(64\), term_id\(64\), class_id\(64\), student_id\(64\)/i);
  assert.match(schema, /school_id\(64\), record_type, academic_year_id\(64\), term_id\(64\), class_id\(64\), subject_id\(64\)/i);
  assert.match(service, /record_type='TERMINAL'/i);
  assert.match(service, /record_type='MOCK'/i);
  assert.match(service, /mock_label IS NULL/i);
  assert.match(schema, /COALESCE\(CONCAT\(LENGTH\(mock_label\)/i);
});

test('schema is additive and persists the service-calculated score components and total', () => {
  const executableSql = schema.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executableSql, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i);
  assert.match(executableSql, /CREATE TABLE IF NOT EXISTS academic_score_records/i);
  assert.match(service, /const totalScore = caScore \+ examScore/);
  assert.match(service, /ca_score,ca_max,examination_score,examination_max,total_score/);
  assert.match(service, /ca_max=0,examination_score=\?,examination_max=100/);
  assert.match(service, /record_type='TERMINAL'.*mock_label IS NULL/s);
  assert.match(service, /record_type='MOCK'.*mock_label=\?/s);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS canonical_academic_scores/i);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS academic_result_records/i);
});

test('protected foundation release validates 063–066, blocks 067-first order, and only scopes 068', () => {
  assert.match(migrationScript, /APPLY_ACADEMIC_SCORE_FOUNDATION_068/);
  assert.match(migrationScript, /BACKUP_CONFIRMED/);
  assert.match(migrationScript, /requiredAppliedVersions: \[63, 64, 65, 66\]/);
  assert.match(migrationScript, /MIGRATION_067_PRECEDES_068/);
  assert.match(migrationScript, /versions: \[VERSION\]/);
  assert.match(migrationScript, /VERSION = 68/);
  assert.match(migrationScript, /assertProductionAcademicMigrationAllowed\(migration, \{ authorizedMigrationVersion: VERSION \}\)/);
  assert.match(lifecycleScript, /requiredAppliedVersions: \[63, 64, 65, 66, 68\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /environment:\s*production/i);
  assert.match(workflow, /\[0-9a-f\]\{40\}/);
  assert.match(workflow, /APPLY_ACADEMIC_SCORE_FOUNDATION_068/);
  assert.doesNotMatch(workflow, /deploy/i);
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 68, name: '068_academic_score_records_foundation.sql' }), { code: 'ACADEMIC_SCORE_FOUNDATION_REQUIRES_PROTECTED_RELEASE' });
});

test('explicit protected scopes safely execute 068 before numeric predecessor 067 without ledger fabrication', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const storage = { applied: migrations.filter((item) => [63,64,65,66].includes(item.version)).map(({ version, name, checksum }) => ({ version, name, checksum, appliedAt: 'existing' })) };
  const adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory: new URL('../schema', import.meta.url), baselineRequired: false });
  const foundation = migrations.find((item) => item.version === 68);
  await runner.applyVersions({ versions: [68], requiredAppliedVersions: [63,64,65,66] });
  assert.equal(storage.applied.at(-1).version, 68);
  await runner.applyVersions({ versions: [67], requiredAppliedVersions: [63,64,65,66,68] });
  assert.deepEqual(storage.applied.slice(-2).map((item) => item.version), [68,67]);
  assert.equal(storage.applied.find((item) => item.version === 68).checksum, foundation.checksum);
  assert.equal(storage.applied.length, 6);
});
