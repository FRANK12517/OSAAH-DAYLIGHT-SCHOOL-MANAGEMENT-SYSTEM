import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const lifecycle = await readFile(new URL('../schema/067_academic_result_lifecycle.sql', import.meta.url), 'utf8');
const legacy = await readFile(new URL('../schema/055_canonical_academic_scores.sql', import.meta.url), 'utf8');
const academic = await readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8');
const lifecycleWorkflow = await readFile(new URL('../scripts/production-academic-result-lifecycle-migrate.mjs', import.meta.url), 'utf8');

test('Migration 067 remains uniquely numbered and checksum-stable within the reviewed definition', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const current = migrations.find((item) => item.version === 67);
  assert.ok(current);
  assert.equal(current.name, '067_academic_result_lifecycle.sql');
  assert.equal(current.checksum, createHash('sha256').update(lifecycle).digest('hex'));
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
});

test('lifecycle metadata remains isolated and does not define a score store', () => {
  assert.match(lifecycle, /CREATE TABLE IF NOT EXISTS academic_result_records/i);
  assert.match(lifecycle, /UNIQUE KEY uq_academic_result_record_scope/i);
  assert.match(lifecycle, /idx_academic_result_record_context/i);
  assert.match(lifecycle, /scope_key_hash CHAR\(64\) GENERATED ALWAYS AS/i);
  assert.match(lifecycle, /LENGTH\(school_id\).*LENGTH\(student_id\).*LENGTH\(class_id\).*LENGTH\(academic_year_id\).*LENGTH\(term_id\).*LENGTH\(examination\)/s);
  assert.match(lifecycle, /COALESCE\(CONCAT\(LENGTH\(mock_label\)/);
  assert.match(lifecycle, /UNIQUE KEY uq_academic_result_record_scope \(scope_key_hash\)/i);
  assert.match(lifecycle, /school_id\(64\), class_id\(64\), academic_year_id\(64\), term_id\(64\)/i);
  assert.doesNotMatch(lifecycle, /UNIQUE KEY uq_academic_result_record_scope \(school_id,/i);
  for (const table of ['schools', 'students', 'classes', 'academic_years', 'terms', 'users']) assert.match(lifecycle, new RegExp(`REFERENCES ${table}\\(id\\)`, 'i'));
  assert.doesNotMatch(lifecycle, /CREATE TABLE IF NOT EXISTS (?:academic_score_records|canonical_academic_scores)/i);
  assert.match(academic, /academic_result_records/);
  assert.match(academic, /academic_score_records/);
});

test('legacy Migration 055 is permanently blocked at the production boundary', async () => {
  assert.match(legacy, /CREATE TABLE IF NOT EXISTS canonical_academic_scores/i);
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 55, name: '055_canonical_academic_scores.sql' }), { code: 'LEGACY_COMPETING_SCORE_STORE_BLOCKED' });
});

test('Migration 067 requires its dedicated exact-version protected workflow', async () => {
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 67, name: '067_academic_result_lifecycle.sql' }), { code: 'ACADEMIC_LIFECYCLE_MIGRATION_REQUIRES_PROTECTED_RELEASE' });
  assert.match(lifecycleWorkflow, /EXECUTION_TOKEN !== APPLY_TOKEN/);
  assert.match(lifecycleWorkflow, /requiredAppliedVersions: \[63, 64, 65, 66, 68\]/);
  assert.match(lifecycleWorkflow, /assertProductionAcademicMigrationAllowed\(migration, \{ authorizedMigrationVersion: VERSION \}\)/);
  assert.match(lifecycleWorkflow, /'databaseCode', 'sqlState', 'databaseMessage'/);
  assert.match(lifecycleWorkflow, /diagnostic \? \{ diagnostic \} : \{\}/);
});

test('Migration 068 also remains blocked from unauthorized production execution', () => {
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 68, name: '068_academic_score_records_foundation.sql' }), { code: 'ACADEMIC_SCORE_FOUNDATION_REQUIRES_PROTECTED_RELEASE' });
});
