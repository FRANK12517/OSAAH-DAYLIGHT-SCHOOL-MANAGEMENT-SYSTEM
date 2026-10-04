import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations, createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';

const lifecycle = await readFile(new URL('../schema/067_academic_result_lifecycle.sql', import.meta.url), 'utf8');
const legacy = await readFile(new URL('../schema/055_canonical_academic_scores.sql', import.meta.url), 'utf8');
const academic = await readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8');

test('Migration 067 is the uniquely numbered additive lifecycle migration', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const current = migrations.find((item) => item.version === 67);
  assert.ok(current);
  assert.equal(current.name, '067_academic_result_lifecycle.sql');
  assert.equal(current.checksum, createHash('sha256').update(lifecycle).digest('hex'));
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
});

test('lifecycle metadata is scoped, durable, and does not define score columns', () => {
  assert.match(lifecycle, /CREATE TABLE IF NOT EXISTS academic_result_records/i);
  assert.match(lifecycle, /UNIQUE KEY uq_academic_result_record_scope/i);
  assert.match(lifecycle, /idx_academic_result_record_context/i);
  for (const table of ['schools', 'students', 'classes', 'academic_years', 'terms', 'users']) assert.match(lifecycle, new RegExp(`REFERENCES ${table}\\(id\\)`, 'i'));
  assert.doesNotMatch(lifecycle, /CREATE TABLE IF NOT EXISTS (?:academic_score_records|canonical_academic_scores)/i);
  assert.match(academic, /academic_result_records/);
  assert.match(academic, /academic_score_records/);
});

test('legacy competing score migration remains historical but is blocked by the runner', async () => {
  assert.match(legacy, /CREATE TABLE IF NOT EXISTS canonical_academic_scores/i);
  const adapter = createInMemoryMigrationAdapter();
  const runner = createMigrationRunner({ adapter, directory: new URL('../schema', import.meta.url) });
  await assert.rejects(() => runner.applyVersions({ versions: [55], requiredAppliedVersions: [], dryRun: false }), (error) => error.code === 'LEGACY_COMPETING_SCORE_STORE_BLOCKED');
  assert.equal(adapter.storage.statements.length, 0);
});

test('Migration 067 is blocked from generic execution until a protected release opts in', async () => {
  const adapter = createInMemoryMigrationAdapter();
  const runner = createMigrationRunner({ adapter, directory: new URL('../schema', import.meta.url) });
  await assert.rejects(() => runner.applyVersions({ versions: [67], dryRun: false }), (error) => error.code === 'ACADEMIC_LIFECYCLE_MIGRATION_REQUIRES_PROTECTED_RELEASE');
  assert.equal(adapter.storage.statements.length, 0);
});
