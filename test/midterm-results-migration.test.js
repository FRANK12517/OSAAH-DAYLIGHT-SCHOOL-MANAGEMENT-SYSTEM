import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const schema = await readFile(new URL('../schema/087_midterm_result_type_support.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8');
const blocking = await readFile(new URL('../src/durable-result-blocking.js', import.meta.url), 'utf8');
const parent = await readFile(new URL('../src/parent-dashboard.js', import.meta.url), 'utf8');
const pdf = await readFile(new URL('../src/result-slip-pdf.js', import.meta.url), 'utf8');

test('Migration 087 is uniquely numbered and only widens the examination scope', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const migration = migrations.find((item) => item.version === 87);
  assert.equal(migration?.name, '087_midterm_result_type_support.sql');
  assert.equal(migration?.checksum, createHash('sha256').update(schema).digest('hex'));
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
  assert.match(schema, /ENUM\('TERMINAL','MOCK','MIDTERM'\)/);
  assert.doesNotMatch(schema, /\b(DROP|DELETE|UPDATE|INSERT|RENAME|TRUNCATE)\b/i);
  assert.throws(() => assertProductionAcademicMigrationAllowed(migration), { code: 'MIDTERM_RESULTS_MIGRATION_REQUIRES_PROTECTED_RELEASE' });
});

test('Midterm uses an exact score/lifecycle scope without changing Terminal and Mock score writers', () => {
  assert.match(service, /\['TERMINAL', 'MOCK', 'MIDTERM'\]/);
  assert.match(service, /resultType, mockLabel/);
  assert.match(service, /record_type='TERMINAL'/);
  assert.match(service, /record_type='MOCK'/);
  assert.match(blocking, /'TERMINAL', 'MOCK', 'MIDTERM'/);
  assert.match(parent, /resultOptions\.resultType/);
  assert.match(pdf, /MIDTERM/);
});
